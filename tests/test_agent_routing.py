import os
import unittest
from unittest.mock import Mock, patch

from backend import goal_agent


class AgentRoutingTests(unittest.TestCase):
    def setUp(self):
        self.history = Mock()
        self.history.sequence_read.return_value = {"head": None, "substitutions": []}
        self.env = patch.dict(os.environ, {"GEMINI_API_KEY": "fixture"})
        self.env.start()
        self.addCleanup(self.env.stop)

    def decision(self, action, message, *, query="", changes=None):
        return {"action": action, "message": message, "query": query, "changes": changes or []}

    def test_greeting_is_answered_without_research_or_plan(self):
        with patch.object(goal_agent, "_model", return_value=self.decision("answer", "Hey! How can I help?")), \
             patch.object(goal_agent, "_search") as search:
            result = goal_agent.respond(self.history, [{"role": "user", "content": "hey"}], consent=True)
        self.assertEqual(result["status"], "answer")
        self.assertEqual(result["answer"], "Hey! How can I help?")
        search.assert_not_called()
        self.history.sequence_save.assert_not_called()

    def test_research_is_separate_and_cites_retrieved_records(self):
        source = {"id": "123", "title": "Paper", "abstract_excerpt": "HBB context",
                  "url": "https://pubmed.ncbi.nlm.nih.gov/123/", "provider": "Europe PMC"}
        assessment = {"questions": [], "interpretation": "The abstract discusses HBB.",
                      "next_steps": ["Review the paper."], "uncertainties": ["Abstract only."], "source_ids": ["123"]}
        with patch.object(goal_agent, "_model", side_effect=[
                self.decision("research", "I'll look for evidence.", query="sickle hemoglobin"), assessment]), \
             patch.object(goal_agent, "_search", return_value=[source]) as search:
            result = goal_agent.respond(self.history, [{"role": "user", "content": "Research sickle hemoglobin"}], consent=True)
        self.assertEqual(result["status"], "plan")
        self.assertEqual(result["used_source_ids"], ["123"])
        search.assert_called_once_with("sickle hemoglobin")
        self.history.sequence_save.assert_not_called()

    def test_agent_can_propose_but_not_commit_a_reviewable_edit(self):
        with patch.object(goal_agent, "_model", return_value=self.decision(
                "propose", "I can prepare that as a sequence hypothesis.",
                changes=[{"position": 7, "alternate": "V", "expected_old": ""}])):
            result = goal_agent.respond(self.history, [{"role": "user", "content": "Represent the HbS variant"}], consent=True)
        self.assertEqual(result["status"], "proposal")
        self.assertEqual(result["proposal"]["changes"], [{"position": 7, "reference": "E", "old": "E", "new": "V"}])
        self.assertIsNone(result["proposal"]["base_head"])
        self.history.sequence_save.assert_not_called()

    def test_expected_residue_mismatch_asks_instead_of_proposing(self):
        self.history.sequence_read.return_value = {
            "head": None, "substitutions": [{"position": 7, "reference": "E", "alternate": "K"}]}
        with patch.object(goal_agent, "_model", return_value=self.decision(
                "propose", "I'll prepare the requested change.",
                changes=[{"position": 7, "alternate": "V", "expected_old": "E"}])):
            result = goal_agent.respond(self.history, [{"role": "user", "content": "Change E7 to V"}], consent=True)
        self.assertEqual(result["status"], "answer")
        self.assertIn("currently contains K, not E", result["answer"])
        self.history.sequence_save.assert_not_called()

    def test_agent_uses_real_history_to_answer_latest_comparison(self):
        self.history.sequence_read.return_value = {
            "head": "b" * 40, "substitutions": [{"position": 7, "reference": "E", "alternate": "V"}],
            "history": [{"commit": "b" * 40}, {"commit": "a" * 40}]}
        self.history.compare.return_value = {"sequence": {"changes": [{"position": 7, "old": "E", "new": "V"}]}}
        with patch.object(goal_agent, "_model", return_value=self.decision("compare", "I'll check.")), \
             patch.object(goal_agent, "_search") as search:
            result = goal_agent.respond(self.history, [{"role": "user", "content": "What changed in my last version?"}], consent=True)
        self.assertEqual(result["status"], "answer")
        self.assertIn("position 7: E → V", result["answer"])
        self.history.compare.assert_called_once_with("a" * 40, "b" * 40)
        search.assert_not_called()


if __name__ == "__main__":
    unittest.main()
