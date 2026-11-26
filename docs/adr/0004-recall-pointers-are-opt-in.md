# 0004: Recall pointers are opt-in

Status: accepted, 2026-11-26 (released in 1.6.0)

Recall pointers, the notes that name an earlier exchange after a file change or at a prompt, were a 1.6.0
headline, yet they ship off: only `PROJECT_MEMORY_RECALL=1` shows them. They had not been measured on real
sessions (the paid evaluation never ran), and each look-up adds about 0.3 to 0.4 s to a prompt or a changed
file, so turning them on for everyone would have put an unmeasured cost and an unproven benefit in every
session. The other-session notes stay on, since they need no measuring to be useful. Turning pointers on by
default needs a measurement on real sessions first.
