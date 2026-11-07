# KLM-GOMS task times (predicted, no participants)

Operators (s): K 0.28, P 1.1, B 0.1, H 0.4, M 1.35. Assumed system time: booking 0.5 s, chatbot 1.5 s.

| Task | Steps | M | P | Clicks | Keys | User (s) | System (s) | Total (s) |
|---|---|---|---|---|---|---|---|---|
| T1: Book a badminton court tomorrow 5-6 pm for 4 people | 9 | 8 | 7 | 8 | 0 | 20.1 | 0.5 | **20.6** |
| T1-form: Same booking on a typical free-text form (comparison design) | 12 | 12 | 7 | 7 | 21 | 34.38 | 0.5 | **34.88** |
| T2-suggest: Time is taken: book an AI suggestion | 3 | 3 | 1 | 1 | 0 | 5.35 | 0.5 | **5.85** |
| T2-manual-1: Time is taken: retry by hand, success on try 1 | 5 | 5 | 3 | 3 | 0 | 10.65 | 0.5 | **11.15** |
| T2-manual-2: Time is taken: retry by hand, success on try 2 | 10 | 10 | 6 | 6 | 0 | 21.3 | 1 | **22.3** |
| T2-manual-3: Time is taken: retry by hand, success on try 3 | 15 | 15 | 9 | 9 | 0 | 31.95 | 1.5 | **33.45** |
| T3-chat: Is a discussion room free this evening? (chatbot) | 3 | 3 | 1 | 1 | 40 | 16.95 | 1.5 | **18.45** |
| T3-browse: Is a discussion room free this evening? (checking rooms by hand, 3 rooms) | 19 | 19 | 16 | 16 | 0 | 46.45 | 1.5 | **47.95** |
| T4: Cancel a booking | 4 | 4 | 3 | 3 | 0 | 9.3 | 0.5 | **9.8** |
| T5: Get the door code for a booking | 3 | 3 | 2 | 2 | 0 | 6.65 | 0.5 | **7.15** |
| T6: Manager: approve a pending request | 3 | 3 | 1 | 1 | 0 | 5.35 | 0.5 | **5.85** |
| T7: Admin: new facility type with 2 rooms (wizard) | 10 | 10 | 8 | 8 | 0 | 23.9 | 0.5 | **24.4** |

## Design comparisons

| Comparison | Ours (s) | Other (s) | Saved | Holds for expert and slower users? |
|---|---|---|---|---|
| Booking form: chips/presets vs free-text form | 20.6 | 34.88 | 14.28 s (40.9%) | yes |
| Clash recovery: suggestion vs 1 manual retry | 5.85 | 11.15 | 5.3 s (47.5%) | yes |
| Clash recovery: suggestion vs 2 manual retries | 5.85 | 22.3 | 16.45 s (73.8%) | yes |
| Clash recovery: suggestion vs 3 manual retries | 5.85 | 33.45 | 27.6 s (82.5%) | yes |
| Free-room question: chatbot vs checking 3 rooms | 18.45 | 47.95 | 29.5 s (61.5%) | yes |

Each task's step-by-step operator list is in klm.json.
