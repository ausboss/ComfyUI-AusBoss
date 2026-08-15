"""Offline tests for how a paused Frame Chooser is resolved.

Several paths can end one pause - two clicks a frame apart, Escape chasing
Enter, the countdown expiring as a POST lands, a deleted node posting a cancel
behind a request that already failed - and exactly one of them may take
effect. claim_pause and answer_pending take the store as an argument and touch
no server module, so those races run here with real threads instead of waiting
for a browser.

_PendingChoice is private on purpose; these tests reach for it because the
pause object is precisely what is under test.
"""

from __future__ import annotations

import sys
import threading
import unittest
from functools import partial
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
if "nodes" in sys.modules and not hasattr(sys.modules["nodes"], "__path__"):
    del sys.modules["nodes"]

from nodes._chooser_helpers import (
    ALREADY_RESOLVED,
    RESOLVED_CANCEL,
    RESOLVED_CONTINUE,
    RESOLVED_TIMEOUT,
    TIMEOUT_CANCEL,
    TIMEOUT_KEEP_FIRST,
    _PendingChoice,
    answer_pending,
    claim_pause,
    new_store,
    read_resolution,
    resolve_timeout_policy,
    resumable_pauses,
)

NODE = "42"
TOKEN = "pause-token-aaaa"
COUNT = 8
# Enough repeats that a claim guarded by nothing loses the race in CI, not
# just on a slow laptop; each trial is two or three short-lived threads.
TRIALS = 150


def paused_store(count: int = COUNT, token: str = TOKEN, node_id: str = NODE):
    """A store holding one pause, registered exactly as await_selection does."""
    store = new_store()
    pending = _PendingChoice(count, payload={"node_id": node_id}, token=token)
    store["pending"][node_id] = pending
    return store, pending


def post(store, action, selected=None, token=TOKEN, node_id=NODE):
    """One POST to the answer route, as (status, body)."""
    data = {"node_id": node_id, "token": token, "action": action}
    if selected is not None:
        data["selected"] = selected
    return answer_pending(store, node_id, data)


def race(*calls):
    """Run every call at once; results come back in argument order.

    The barrier lines the threads up on the instruction before the claim,
    which is what turns a single lock acquisition into a contended one."""
    results = [None] * len(calls)
    barrier = threading.Barrier(len(calls))

    def run(index, call):
        barrier.wait()
        results[index] = call()

    threads = [threading.Thread(target=run, args=(i, c)) for i, c in enumerate(calls)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    return results


class TwoAnswersTests(unittest.TestCase):
    """Two answers for the same pause: one lands, the other is told so."""

    def test_simultaneous_answers_leave_one_winner_every_trial(self):
        for trial in range(TRIALS):
            store, pending = paused_store()
            picks = ([1, 2], [7])
            results = race(
                partial(post, store, "continue", picks[0]),
                partial(post, store, "continue", picks[1]),
            )
            statuses = [status for status, _ in results]
            self.assertEqual(sorted(statuses), [200, 410], f"trial {trial}")
            winner = statuses.index(200)
            # The selection recorded is the winner's, and the loser was never
            # told its own frames are the ones the graph will run on.
            self.assertEqual(
                read_resolution(store, pending),
                (RESOLVED_CONTINUE, picks[winner]),
            )
            self.assertEqual(results[winner][1]["kept"], len(picks[winner]))
            self.assertEqual(results[1 - winner][1]["error"], ALREADY_RESOLVED)

    def test_a_crowd_of_answers_still_resolves_once(self):
        # A held-down Enter key, or several tabs answering together.
        for _ in range(TRIALS):
            store, pending = paused_store()
            results = race(*[partial(post, store, "continue", [n]) for n in range(1, 7)])
            statuses = [status for status, _ in results]
            self.assertEqual(statuses.count(200), 1)
            self.assertEqual(statuses.count(410), len(statuses) - 1)
            outcome, selection = read_resolution(store, pending)
            self.assertEqual(outcome, RESOLVED_CONTINUE)
            self.assertEqual(selection, [statuses.index(200) + 1])

    def test_the_second_answer_changes_neither_selection_nor_result(self):
        store, pending = paused_store()
        self.assertEqual(post(store, "continue", [3])[0], 200)
        status, body = post(store, "continue", [1, 2, 3, 4])
        self.assertEqual(status, 410)
        self.assertEqual(body["error"], ALREADY_RESOLVED)
        self.assertNotIn("kept", body)
        self.assertEqual(read_resolution(store, pending), (RESOLVED_CONTINUE, [3]))


class ContinueVersusCancelTests(unittest.TestCase):
    """Escape chasing Enter, or the other way round."""

    def test_cancel_racing_continue_resolves_exactly_one_way(self):
        for trial in range(TRIALS):
            store, pending = paused_store()
            results = race(
                partial(post, store, "continue", [3]),
                partial(post, store, "cancel"),
            )
            statuses = [status for status, _ in results]
            self.assertEqual(sorted(statuses), [200, 410], f"trial {trial}")
            outcome, selection = read_resolution(store, pending)
            if statuses[0] == 200:
                # The continue won: the losing cancel must not have turned a
                # run that is carrying on into an interrupt.
                self.assertEqual((outcome, selection), (RESOLVED_CONTINUE, [3]))
                self.assertEqual(results[0][1]["status"], "continued")
            else:
                self.assertEqual((outcome, selection), (RESOLVED_CANCEL, None))
                self.assertEqual(results[1][1]["status"], "cancelled")

    def test_a_cancel_behind_a_landed_continue_cannot_stop_the_run(self):
        store, pending = paused_store()
        self.assertEqual(post(store, "continue", [2, 4])[0], 200)
        status, body = post(store, "cancel")
        self.assertEqual(status, 410)
        self.assertEqual(body["error"], ALREADY_RESOLVED)
        self.assertEqual(read_resolution(store, pending), (RESOLVED_CONTINUE, [2, 4]))

    def test_a_continue_behind_a_landed_cancel_cannot_restart_the_run(self):
        store, pending = paused_store()
        self.assertEqual(post(store, "cancel")[0], 200)
        self.assertEqual(post(store, "continue", [2, 4])[0], 410)
        self.assertEqual(read_resolution(store, pending), (RESOLVED_CANCEL, None))


class TimeoutVersusPostTests(unittest.TestCase):
    """The countdown firing in the same instant an answer arrives."""

    def test_expiring_countdown_racing_an_answer_resolves_once(self):
        fallback = resolve_timeout_policy(TIMEOUT_KEEP_FIRST, COUNT)
        self.assertEqual(fallback, [1])
        for trial in range(TRIALS):
            store, pending = paused_store()
            (answer, timeout_won) = race(
                partial(post, store, "continue", [5]),
                partial(claim_pause, store, pending, RESOLVED_TIMEOUT, fallback),
            )
            status, _ = answer
            self.assertEqual(
                [status == 200, bool(timeout_won)].count(True), 1, f"trial {trial}"
            )
            if status == 200:
                self.assertEqual(
                    read_resolution(store, pending), (RESOLVED_CONTINUE, [5])
                )
            else:
                self.assertEqual(status, 410)
                self.assertEqual(read_resolution(store, pending), (RESOLVED_TIMEOUT, [1]))

    def test_a_cancel_policy_timeout_racing_an_answer_resolves_once(self):
        fallback = resolve_timeout_policy(TIMEOUT_CANCEL, COUNT)
        self.assertIsNone(fallback)
        for trial in range(TRIALS):
            store, pending = paused_store()
            (answer, timeout_won) = race(
                partial(post, store, "continue", [6]),
                partial(claim_pause, store, pending, RESOLVED_CANCEL, fallback),
            )
            status, _ = answer
            self.assertEqual(
                [status == 200, bool(timeout_won)].count(True), 1, f"trial {trial}"
            )
            expected = (RESOLVED_CONTINUE, [6]) if status == 200 else (RESOLVED_CANCEL, None)
            self.assertEqual(read_resolution(store, pending), expected)

    def test_an_answer_after_the_countdown_fired_is_refused(self):
        store, pending = paused_store()
        self.assertTrue(claim_pause(store, pending, RESOLVED_TIMEOUT, [1]))
        self.assertEqual(post(store, "continue", [4])[0], 410)
        self.assertEqual(read_resolution(store, pending), (RESOLVED_TIMEOUT, [1]))

    def test_the_queue_stopping_claims_the_pause_before_an_answer_can(self):
        # What the wait loop does when processing_interrupted() goes true.
        store, pending = paused_store()
        self.assertTrue(claim_pause(store, pending, RESOLVED_CANCEL))
        self.assertEqual(post(store, "continue", [1])[0], 410)
        self.assertEqual(read_resolution(store, pending), (RESOLVED_CANCEL, None))


class FailedRequestTests(unittest.TestCase):
    """A request that fails must not spend the pause it aimed at."""

    def test_a_rejected_selection_leaves_the_pause_answerable(self):
        store, pending = paused_store()
        status, body = post(store, "continue", [COUNT + 1])
        self.assertEqual(status, 400)
        self.assertIn(str(COUNT + 1), body["error"])
        self.assertIsNone(pending.resolution)
        # The cancel a node deleted behind that failure posts still lands.
        self.assertEqual(post(store, "cancel")[0], 200)
        self.assertEqual(read_resolution(store, pending), (RESOLVED_CANCEL, None))

    def test_deletion_racing_a_rejected_answer_still_stops_the_run(self):
        for trial in range(TRIALS):
            store, pending = paused_store()
            results = race(
                partial(post, store, "continue", [COUNT + 4]),
                partial(post, store, "cancel"),
            )
            self.assertEqual(results[0][0], 400, f"trial {trial}")
            self.assertEqual(results[1][0], 200, f"trial {trial}")
            self.assertEqual(read_resolution(store, pending), (RESOLVED_CANCEL, None))

    def test_an_unknown_action_leaves_the_pause_answerable(self):
        store, pending = paused_store()
        self.assertEqual(post(store, "keep-maybe")[0], 400)
        self.assertIsNone(pending.resolution)
        self.assertEqual(post(store, "continue", [1])[0], 200)

    def test_a_stale_token_is_refused_before_any_claim(self):
        store, pending = paused_store()
        status, _ = post(store, "cancel", token="pause-token-bbbb")
        self.assertEqual(status, 409)
        self.assertIsNone(pending.resolution)

    def test_a_stale_token_stays_a_409_after_the_pause_resolved(self):
        store, pending = paused_store()
        self.assertEqual(post(store, "continue", [1])[0], 200)
        # Which pause the panel was answering is the more useful complaint.
        self.assertEqual(post(store, "cancel", token="pause-token-bbbb")[0], 409)

    def test_a_body_that_is_not_an_object_is_a_400(self):
        # Valid JSON is not necessarily a dict; reaching .get() on a list
        # threw an AttributeError out of the aiohttp handler as a 500.
        store, pending = paused_store()
        for body in ([], "answer", 5, None, True):
            status, _ = answer_pending(store, NODE, body)
            self.assertEqual(status, 400, repr(body))
        self.assertIsNone(pending.resolution)
        self.assertEqual(post(store, "continue", [1])[0], 200)

    def test_an_answer_after_the_waiter_unwound_is_a_404(self):
        store, pending = paused_store()
        claim_pause(store, pending, RESOLVED_CANCEL)
        del store["pending"][NODE]  # what await_selection's finally does
        self.assertEqual(post(store, "cancel")[0], 404)


class ResolutionReadTests(unittest.TestCase):
    def test_an_unresolved_pause_reads_as_a_cancel(self):
        # The wait loop can only reach the read without a claim by unwinding,
        # and releasing a graph on a selection nobody chose would be worse.
        _, pending = paused_store()
        store = new_store()
        self.assertEqual(read_resolution(store, pending), (RESOLVED_CANCEL, None))

    def test_the_recorded_selection_is_a_copy(self):
        store, pending = paused_store()
        picks = [2, 5]
        self.assertTrue(claim_pause(store, pending, RESOLVED_CONTINUE, picks))
        picks.append(7)
        self.assertEqual(read_resolution(store, pending), (RESOLVED_CONTINUE, [2, 5]))

    def test_a_resolved_pause_is_not_offered_to_a_reloading_page(self):
        store, pending = paused_store()
        self.assertEqual(resumable_pauses(store), [pending])
        claim_pause(store, pending, RESOLVED_CONTINUE, [1])
        self.assertEqual(resumable_pauses(store), [])


if __name__ == "__main__":
    unittest.main()
