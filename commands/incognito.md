---
description: Stop saving this conversation to project-memory, and sweep what it already saved
---

Run this with Bash, then report its output plainly, word for word where it says what is and is not covered:

```
node "${CLAUDE_PLUGIN_ROOT}/memory.mjs" incognito --session ${CLAUDE_SESSION_ID}
```

If it says `incognito NOT applied`, tell the user it did not work and why. Do not say it is on. Until it says it is on, save no note unless the user asks.
