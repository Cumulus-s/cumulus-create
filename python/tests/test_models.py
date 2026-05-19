import unittest

from cumulus_knowledge.models import AxiEnvelope
from cumulus_knowledge.operations import (
    build_relationship_candidates,
    detect_schedule_shipping_risk,
    extract_operations_entities,
    score_graph_readability,
)


class EnvelopeTests(unittest.TestCase):
    def test_envelope_from_dict(self) -> None:
        envelope = AxiEnvelope.from_dict({"ok": True, "data": {"id": "node_1"}, "meta": {"command": "x"}, "links": []})
        self.assertTrue(envelope.ok)
        self.assertEqual(envelope.data["id"], "node_1")
        self.assertEqual(envelope.meta["command"], "x")


class OperationsTests(unittest.TestCase):
    def test_extracts_operations_entities_and_scores_graph(self) -> None:
        with self.subTest("entities"):
            import tempfile
            from pathlib import Path

            with tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                (root / "finance.md").write_text(
                    "Invoice DEMO-INV-001\nBank: Atlas Demo Bank\nDraw Request: Bank Draw Request #2\nVendor: BrightSteel Demo Supply\nSteel delivery delayed\n",
                    encoding="utf-8",
                )
                entities = extract_operations_entities(root)
                kinds = {item["kind"] for item in entities}
                self.assertIn("invoice", kinds)
                self.assertIn("bank", kinds)
                self.assertIn("bank_draw", kinds)
                self.assertIn("vendor", kinds)
                self.assertTrue(any(item["label"] == "Bank Draw Request #2" for item in entities))
                self.assertFalse(any(item["kind"] == "bank" and "Draw Request" in item["label"] for item in entities))
                self.assertTrue(build_relationship_candidates(entities))
                self.assertTrue(detect_schedule_shipping_risk(entities))
        with self.subTest("readability"):
            score = score_graph_readability({
                "nodes": [{"display_label": "Invoice DEMO-INV-001"}],
                "legend": {"node_kinds": [{"kind": "invoice"}]},
                "evidence": [{"node_id": "n1"}],
            })
            self.assertTrue(score["passed"])


if __name__ == "__main__":
    unittest.main()
