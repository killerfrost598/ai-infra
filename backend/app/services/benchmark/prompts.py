# Canonical prompt set for inference benchmarks

PROMPT_SHORT = (
    "You are a technical writer. Explain in detail how a CPU's branch predictor "
    "works, including the difference between static and dynamic prediction, "
    "two-bit saturating counters, and the role of the branch target buffer. "
    "Be precise and concise."
)

PROMPT_LONG = (
    "The following is an excerpt from a technical manual on distributed systems. "
    "Distributed systems face fundamental challenges that arise from the laws of "
    "physics and the nature of networks. The CAP theorem states that a distributed "
    "system cannot simultaneously provide more than two of three guarantees: "
    "consistency, availability, and partition tolerance. In practice, network "
    "partitions are unavoidable, so designers must choose between consistency and "
    "availability. A consistent system ensures that every read receives the most "
    "recent write or an error, while an available system guarantees that every "
    "request receives a non-error response, though it may not contain the most "
    "recent data. Partition-tolerant systems continue operating despite network "
    "splits between nodes. The PACELC theorem extends CAP by noting that even "
    "without partitions, there is a latency-consistency trade-off. Systems like "
    "Apache Cassandra prioritize availability and partition tolerance, offering "
    "tunable consistency. Apache ZooKeeper and etcd prioritize consistency. "
    "Consensus algorithms such as Paxos and Raft allow distributed systems to "
    "agree on values despite node failures. Raft divides the problem into leader "
    "election, log replication, and safety. The leader receives all writes and "
    "replicates them to followers. If the leader fails, a new election begins. "
    "A candidate wins by receiving votes from a majority of nodes. This ensures "
    "that only one leader exists per term and that committed entries are preserved "
    "across leader changes. Distributed databases like Google Spanner use "
    "TrueTime, GPS clocks, and atomic clocks to provide externally consistent "
    "transactions across globally distributed data centers. The key insight is "
    "that if the uncertainty in clock readings is bounded, transactions can be "
    "ordered correctly by waiting out the uncertainty window before committing. "
    "Please summarize the key trade-offs in distributed system design described above."
)

DEFAULT_MAX_TOKENS = 512
TTFT_MAX_TOKENS = 128
