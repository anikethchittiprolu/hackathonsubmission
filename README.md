# VYOM Hackathon Portal

Zero-dependency Node app (Node 22+). Participant portal at `/`, admin portal at `/admin`.

    node server.js                       # http://localhost:3000
    ADMIN_PASSWORD=yourpass PORT=8080 node server.js

Admin password is printed on first start and saved to `data/admin_password.txt` unless `ADMIN_PASSWORD` is set.
Data lives in `data/` (SQLite DB + uploaded files) — back it up; delete it to reset.

**Participants:** live countdown, now/next, timetable, announcements; register a team, save drafts, upload files, mark final. Locks at the deadline.
**Admin:** overview, all submissions (links + files), schedule/announcement editors, settings (dates, tracks, rubric, judges), paper-jury scoring (print sheets, key-in grid or CSV paste, leaderboard), CSV export.

## Event-day flow
1. **Team logins** tab → generate one login per team (`VYOM-001…`, random password, shared by all members). Passwords are shown once; download the CSV and hand it to your main website for delivery. Lost one? "Reset password".
2. **Problem statements** tab → write the problems; teams read them on the portal and pick one in their submission.
3. **Perks** tab → paste your one-time Canva / Miro / surprise-AI links per pool.
4. At check-in, tick **In** and set the **Table** number on the Submissions tab. Teams see it live and their perk unlocks (perks unlock only after check-in).
5. Teams sign in, fill team details (name + 2–4 members), pick a problem, submit GitHub + deck (+ optional files/links).
6. Scoring tab → print the jury sheet (ordered by table), key in scores after the live demos, read the leaderboard.
