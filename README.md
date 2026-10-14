# VYOM Hackathon Portal

Zero-dependency Node.js app (Node 22+). Participant portal at `/`, admin portal at `/admin`.

## Run the Application

```bash
node server.js
```

Open http://localhost:3000 in your browser.

To use a custom admin password and port:

```bash
ADMIN_PASSWORD=yourpass PORT=8080 node server.js
```

The admin password is printed on first start and saved to `data/admin_password.txt` unless `ADMIN_PASSWORD` is set.

Data is stored in `data/` (SQLite database and uploaded files). Back up this folder to preserve data. Delete it only if you intend to reset the data.

## Participant Features

- Live countdown, current and upcoming events, timetable, and announcements.
- Team registration and draft saving.
- File uploads and final submission.
- Automatic submission locking at the deadline.

## Admin Features

- Dashboard overview and submission management.
- Schedule and announcement editors.
- Settings for dates, tracks, rubric, and judges.
- Jury scoring, printable sheets, score entry, CSV import, and leaderboard.
- CSV export.

## Event-Day Workflow

1. **Team logins:** Generate one login per team (`VYOM-001…`). Download the CSV and distribute the credentials securely. Passwords are shown once; use the reset option if needed.
2. **Problem statements:** Add the problem statements that participants can read and select.
3. **Perks:** Add one-time Canva, Miro, or other resource links for each pool.
4. **Check-in:** Mark teams as checked in and assign table numbers. Perks unlock after check-in.
5. **Team submissions:** Participants sign in, enter team details (name and 2–4 members), select a problem, and submit their GitHub repository, presentation deck, and optional files or links.
6. **Jury scoring:** Print jury sheets ordered by table, enter scores after live demos, and review the leaderboard.
