---
description: Turn project-memory off in this project (nothing saved, tiered or snapshotted until memory on)
---

Run this with Bash, then report its output plainly:

```
node "${CLAUDE_PLUGIN_ROOT}/memory.mjs" off --session ${CLAUDE_SESSION_ID}
```

If it says `NOT applied`, tell the user it is still on and why.
