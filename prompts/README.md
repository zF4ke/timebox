# Test Prompts

These files are natural-language student inputs for comparing planner models in Timebox.
Each `.txt` file can be pasted directly into the app composer.

The set is intentionally varied:

- urgent deadlines
- grade-weighted priorities
- vague tasks and hidden work
- group projects
- fixed commitments
- wellbeing and low-energy constraints
- overloaded weeks
- no-deadline planning
- exam-heavy periods
- part-time work and commuting
- conflicting user preferences
- long planning windows

Suggested use: run the same prompt with each model, export JSON, and compare approval count, iterations, validation issues, hard metrics, and final evaluation score.

## Prompt Index

1. `01_urgent_mixed_deadlines.txt` - Several academic tasks due soon with different urgency.
2. `02_wellbeing_low_energy.txt` - Same-week work while sleep and energy are poor.
3. `03_grade_weighted_priorities.txt` - Tasks with different grade weights and importance.
4. `04_group_project_coordination.txt` - Group project with meetings, dependencies, and presentation work.
5. `05_fixed_commitments_busy_week.txt` - Many fixed commitments limiting availability.
6. `06_uncertain_scope_hidden_work.txt` - Vague tasks where effort and risk estimation matter.
7. `07_exam_week_revision.txt` - Exam-focused planning with spaced revision.
8. `08_part_time_job_commute.txt` - Student with work shifts and commute fatigue.
9. `09_no_deadlines_self_study.txt` - No firm deadlines; tests default planning window and balance.
10. `10_overloaded_impossible_week.txt` - More work than time, forcing compromise.
11. `11_short_two_day_crunch.txt` - Very short planning window with a close deadline.
12. `12_long_term_capstone.txt` - Longer project with milestones and uncertain dependencies.
13. `13_conflicting_preferences.txt` - User asks for intensity but also says they are exhausted.
14. `14_many_small_tasks.txt` - Many small deliverables and admin tasks.
15. `15_missed_start_recovery.txt` - Student is behind and needs recovery planning.
