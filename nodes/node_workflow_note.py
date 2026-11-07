"""Workflow Note 🆎 — the card that makes a shared workflow self-explanatory.

The whole node is a presentation surface: a title banner, a short how-to in
Markdown, the models it needs with download buttons and the folder each one
goes in, the node packs it depends on, and the author's links. The frontend
checks the model files and node packs against this install and marks each
row installed or missing, so a downloaded workflow tells its new owner what
is left to do before the first run.

The backend keeps one hidden STRING widget holding the card as JSON, so
save/load, undo and the API format all ride LiteGraph's default path. Nothing
executes: the node has no outputs and is never part of the prompt graph.
"""

from __future__ import annotations


class AusBossWorkflowNote:
    CATEGORY = "🆎 AusBoss/Utility"
    DESCRIPTION = (
        "A workflow card for sharing: a big title, a Markdown how-to, the "
        "models the workflow needs with download buttons and the folder "
        "each goes in, the node packs it depends on, and your links. Each "
        "model and pack row is checked against this install and marked "
        "installed or missing, so whoever opens the workflow sees exactly "
        "what is left to set up. Click the pencil to edit; switch to the "
        "banner layout for a plain title label. Nothing runs — the node has "
        "no outputs."
    )
    SEARCH_ALIASES = [
        "note",
        "readme",
        "workflow note",
        "model links",
        "download models",
        "label",
        "title",
        "banner",
        "credits",
        "ausboss",
    ]

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "note": (
                    "STRING",
                    {
                        "default": "{}",
                        "multiline": True,
                        "tooltip": (
                            "The card as JSON: title, subtitle, author, "
                            "Markdown body, model rows, node-pack rows and "
                            "links. The pencil on the card edits it; this "
                            "field is the storage behind that editor."
                        ),
                    },
                ),
            },
        }

    RETURN_TYPES = ()
    FUNCTION = "noop"

    def noop(self, note):
        # Never reached: with no outputs and OUTPUT_NODE unset the node is
        # not part of any prompt. Kept so the class is a complete node.
        return ()


class AusBossWorkflowNoteTile(AusBossWorkflowNote):
    DESCRIPTION = (
        "A compact help button that opens a full workflow note. "
        "Click to read; use the pencil to edit its instructions and model "
        "links. Saved tiles require a pack that supports tiles, so an older "
        "install can report the missing node. Nothing runs."
    )
    SEARCH_ALIASES = ["workflow note tile", "help button", "popout note", "ausboss"]

    @classmethod
    def INPUT_TYPES(cls):
        inputs = super().INPUT_TYPES()
        inputs["required"]["note"][1]["default"] = (
            '{"title":"Workflow info","layout":"tile"}'
        )
        return inputs


NODE_CLASS_MAPPINGS = {
    "AUSBOSS_NODES_WorkflowNote": AusBossWorkflowNote,
    "AUSBOSS_NODES_WorkflowNoteTile": AusBossWorkflowNoteTile,
}
NODE_DISPLAY_NAME_MAPPINGS = {
    "AUSBOSS_NODES_WorkflowNote": "Workflow Note 🆎",
    "AUSBOSS_NODES_WorkflowNoteTile": "Workflow Note Tile 🆎",
}

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]
