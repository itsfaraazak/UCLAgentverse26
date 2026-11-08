"""DeltaGene agents.

Every agent in this package follows the same contract (see base.Agent):
it reads Deltas from a shared DeltaDAG and writes new, typed Deltas back
to it. Agents never mutate or delete a prior Delta -- disagreement always
produces a new Delta with the disputed one as a parent, so the DAG is a
complete, replayable audit trail.
"""
