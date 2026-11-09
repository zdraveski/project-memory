// The mutate workflow's plan: one shard per machine, as a GitHub step output.
const machines = Math.min(256, Math.max(1, Math.floor(Number(process.env.MACHINES)) || 17));
console.log(`shards=${JSON.stringify(Array.from({ length: machines }, (_, i) => i + 1))}`);
