# SDG Hackathon Evaluation App

A web app for running the SDG-themed hackathon: evaluators enter rubric scores on their phones, and the app works out totals, rankings, shortlists, and PO / PSO / SDG attainment automatically. Admins set targets, manage the rubric and teams, and download an Excel report.

It runs entirely on free services:

| Part | Service | What it does |
|---|---|---|
| Database, logins, security | [Supabase](https://supabase.com) free plan | Stores teams and scores; calculates attainment; enforces who can see and edit what |
| Website | [Vercel](https://vercel.com) or [Netlify](https://netlify.com) free plan | Hosts the React app |

```
sdg-hackathon/
├── supabase/schema.sql   ← run once in Supabase
├── app/                  ← React app (Vite)
├── netlify.toml          ← build settings if you use Netlify
└── README.md
```

---

## 1. Set up the database (Supabase)

> **Already set up with an earlier version?** Don't run `schema.sql` again. In the SQL Editor, run whichever of these you haven't run yet, in order. Each keeps all existing teams, marks and settings.
> - `supabase/migration_002_sdg_strength.sql`: SDG contribution-strength ratings
> - `supabase/migration_003_team_registration.sql`: team self-registration and team leaderboards
> - `supabase/migration_004_evaluator_approval.sql`: new evaluator accounts need admin approval

1. Sign up at supabase.com and click **New project**. Pick a region close to you (for example Mumbai), set a database password, and wait for it to finish.
2. Open **SQL Editor ▸ New query**, paste in the whole of `supabase/schema.sql`, and click **Run**. You should see "Success". This creates:
   - the tables (rounds, teams, rubric, mapping, scores, settings),
   - the security rules,
   - the calculation views,
   - the rubric (9 criteria, 100 marks), the rubric → PO/PSO mapping, the 17 SDGs, the SDG contribution-strength ratings, and the six rounds (3A, 3B, 3rd-sem inter-section, 5A, 5B, 5th-sem inter-section).
3. Optional but recommended: **Authentication ▸ Sign In / Providers ▸ Email**, turn off **Confirm email**, so evaluators can sign in immediately after creating an account. If you leave it on, they must click the link in their confirmation email first.
4. Open **Project Settings ▸ API** (or **API Keys**) and copy two values:
   - **Project URL**, e.g. `https://abcdxyz.supabase.co`
   - **anon / publishable key**

   Never use the `service_role` / secret key in the app.

## 2. Put the website online

### Option A: Vercel

1. Put this folder in a GitHub repository.
2. At vercel.com, click **Add New ▸ Project** and import the repository.
3. Set **Root Directory** to `app`. Vercel detects Vite automatically: the build command is `npm run build` and the output directory is `dist`.
4. Under **Environment Variables**, add:
   - `VITE_SUPABASE_URL` = your Project URL
   - `VITE_SUPABASE_ANON_KEY` = your anon / publishable key
5. Click **Deploy**. You get a link like `https://sdg-hackathon.vercel.app`.

### Option B: Netlify

1. Put this folder in a GitHub repository.
2. At netlify.com, click **Add new site ▸ Import an existing project** and pick the repository. The included `netlify.toml` already sets the base folder, build command and publish folder.
3. Under **Site configuration ▸ Environment variables**, add the same two variables, then **Deploy**.

If you change the environment variables later, redeploy: they are baked in at build time.

### Running it on your own computer (optional)

```bash
cd app
cp .env.example .env.local      # then put your two Supabase values in .env.local
npm install
npm run dev                     # opens on http://localhost:5173
```

## 3. First use

1. Open the site and choose **Evaluator portal ▸ New evaluator? Create an account**. **The first evaluator account becomes the admin automatically**, so create yours before sharing any links. Team accounts never become admin.

   The site has separate sign-in and registration pages for the two kinds of account:
   - **Team portal:** `https://your-site/#/team`
   - **Evaluator portal:** `https://your-site/#/evaluator`

   The home page lets people pick either. Both links are also shown on the **People** page. Each portal only accepts its own kind of account; signing in through the wrong one points the person to the right portal.
2. **Rubric & targets**: check the target (default 60%), the level thresholds (70 / 60 / 50% of teams), the mapping, and the rubric descriptors.
3. **People**: copy the evaluator portal link shown there and send it to your evaluators.
   - Each new evaluator account waits under **Evaluator requests** until you approve or decline it. The Dashboard also shows how many are waiting.
   - Until you approve them, they see a "Waiting for approval" screen and can't see any rounds, teams or marks.
   - Check each name and email before approving. Anyone with the link can sign up, including students.
   - You can make other faculty admins here too.
4. **Rounds & teams ▸ Manage** for each section round:
   - Enter the date and venue.
   - Tick the evaluators judging that round.
   - Add teams one at a time, or open **Add many teams at once** and paste rows from Excel in this order: Team ID, Team name, Members, Primary SDG number, Secondary SDG number, Problem statement.
4a. **Team self-registration (optional).** On a section round's page, click **Open registration**. Share the team portal link. Teams choose **New team? Create a team account**, sign up with one member's email, and fill in:
   - the round;
   - the team name;
   - every member's name and USN (team size limits are set on **Rubric & targets**);
   - a contact phone;
   - the primary SDG, an optional secondary SDG, and the SDG targets they address;
   - the problem statement and proposed solution.

   Each team gets a code such as `3A-08` and can edit its details until you close registration or evaluation of the team starts. Self-registered teams sit alongside the ones you add, marked "Self-registered" with their contact details.
5. On the day, evaluators sign in, pick their round and team, mark the 9 rubric criteria, and then rate how strongly the solution advances each SDG the team claims (0 None, 1 Low, 2 Medium, 3 High). Everything saves when they press **Save scores**, and they can revise it until you close scoring. A team shows as done once all criteria and all claimed SDGs are rated.
6. When a section round is finished, click **Close scoring** on its page.
7. When both sections of a semester are finished, open the inter-section round and click **Pull shortlisted teams**. It copies the top 5 of each section. Assign evaluators to this round as well.
8. **Dashboard** shows results live. Choose **All rounds together** or a single round. There are two downloads:
   - **Download formatted workbook**: the department's full evaluation workbook, filled with every team, evaluator, rubric mark and SDG rating from the app. It keeps all the sheets, formatting, formulas, attainment tables and charts, so it's the version to put in accreditation files. Excel, LibreOffice or Google Sheets calculate the results when the file opens.
   - **Download data export**: plain tables of every result and raw mark, handy for your own analysis.

## 4. How the numbers are calculated

The formulas are the same as the Excel workbook.

| Step | Formula |
|---|---|
| Criterion score | Average of the evaluators who marked it |
| Total, % | Sum of criterion averages; ÷ total maximum marks |
| Rank | By total. Ties are broken by the criterion marked "Use to break ties" (Technical Implementation by default), then by the order teams were added |
| Team attainment for PO/PSO | Σ(criterion score ÷ max × correlation) ÷ Σ correlation, using the 3/2/1 mapping. Only calculated once every linked criterion has a mark |
| Round attainment level | % of teams whose attainment ≥ target: Level 3 if ≥ 70%, 2 if ≥ 60%, 1 if ≥ 50%, else 0 (all editable) |
| SDG contribution strength | Each evaluator rates every SDG a team claims (primary and, if any, secondary): 3 High, 2 Medium, 1 Low, 0 None. A solution's strength is the average across evaluators. These ratings are not part of the 100 marks and do not affect rank |
| SDG attainment (round) | Average strength over every rated team–SDG pair in the round, plus the % of pairs at or above the target strength (default 2, Medium; editable) |
| SDG goal-wise | For each of the 17 goals, the average strength of all solutions addressing it, with the same % at target |
| All rounds together | Teams from every round are pooled, not averaged round by round. Finalists therefore count in both their section round and the inter-section round |

### Team leaderboards

Each round has a **Publish leaderboard** switch on its page, off by default.

When published, teams in that round see:
- every team's rank, total, % and shortlist status;
- their own average marks for each criterion;
- their own SDG contribution strength.

They never see individual evaluators' marks or other teams' member and contact details. Shortlisted teams also see the inter-section round's leaderboard once you publish it. The leaderboard updates live, so publish it when you're comfortable with teams seeing scores, or after evaluation ends.

## 5. Who can do what

Supabase row-level security enforces this rule in the database itself, not just in the web pages.

| | Team | Evaluator | Admin |
|---|---|---|
| See rounds and teams | Only its own registration | Only rounds assigned to them | All |
| Enter and edit marks | No | Only their own, only while the round is open | Anyone's, any time |
| See other evaluators' marks and results | Leaderboard totals only, once published | No | Yes |
| Change targets, rubric, mapping, teams, roles | No | No | Yes |
| Before admin approval | Registers straight away | Sees only a "waiting for approval" screen | First account is admin |

The app always keeps at least one admin.

## 6. Good to know

- **Free-plan pauses.** A free Supabase project pauses after about a week with no activity. Before each round, open your project in Supabase and click **Restore** if it is paused. Nothing is lost.
- **Open sign-up.** Anyone with the link can create an account. Evaluator accounts see nothing until you assign them to a round; team accounts can only register while a round's registration is open. Once your evaluators have signed up, you can turn off new sign-ups in Supabase (**Authentication ▸ Sign In / Providers ▸ Allow new users to sign up**).
- **Change the rubric before scoring starts.** Changing a criterion's maximum marks after marks are in rescales every result, and deleting a criterion deletes its marks.
- **Pulling finalists** only works while the inter-section round has no marks yet. Pull again (it replaces the earlier pull) if a section's results change before the finals start.
- **Password reset.** If an evaluator forgets their password, an admin can send a reset email from Supabase ▸ Authentication ▸ Users.
- **Backups.** The Excel report is a full snapshot of teams, marks and attainment. Download one after each round.

### Limits of the formatted workbook

The workbook has fixed room, so the app tells you when something doesn't fit:
- up to 20 teams per section round and 10 per inter-section round;
- up to 3 evaluators per round (the 3 who gave marks, in name order);
- exactly 9 rubric criteria and the 13 PO/PSO outcomes;
- ties broken on criterion 4, as in the workbook.

If you change the rubric's structure, use the data export, or regenerate the template with `tools/build_workbook.py` (`python build_workbook.py report-template.xlsx`) and copy it to `app/public/report-template.xlsx`.

## 7. Changing things later

- **Another semester or section:** add a row in Supabase ▸ Table Editor ▸ `events`. Set `kind` to `intra` or `inter`, and point `feeds_into` of section rounds at their inter-section round.
- **Wording of POs or PSOs:** edit Table Editor ▸ `outcomes`.
- **Next year's hackathon:** create a fresh Supabase project and run `schema.sql` again. This keeps each year's records separate.
