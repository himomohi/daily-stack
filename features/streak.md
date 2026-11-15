# Streak and best time

- localStorage key `daily-stack-v1`: streak, best streak, last win date, total wins, best time per day.
- A win the day after the last win adds 1; a same-day win keeps the streak; a gap resets to 1.
- Safe when storage is blocked (falls back to defaults).
