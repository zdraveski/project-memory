---
description: Turn project-memory back on in this project
---

Run this with Bash, then report its output plainly:

```
node "${CLAUDE_PLUGIN_ROOT}/memory.mjs" on --session ${CLAUDE_SESSION_ID}
```

If it says `NOT applied`, tell the user it is still off and why.
