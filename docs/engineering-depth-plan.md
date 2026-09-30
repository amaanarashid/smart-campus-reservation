# Adding engineering depth: the maths behind the booking system

Written after supervisor feedback that the project needs proper analysis from
first principles, not just a working web app.

---

## 1. What the accreditation standard asks for

The EAC standard defines what counts as a complex engineering problem. Two of
the attributes matter here. Quoted directly:

> WP1 — Depth of knowledge required. Cannot be resolved without in-depth
> engineering knowledge at the level of one or more of WK3, WK4, WK5, WK6 or
> WK8 which allows a fundamental-based, first principles analytical approach.

> WP3 — Depth of analysis required. Have no obvious solution and require
> abstract thinking, originality in analysis to formulate suitable models.

A project has to show WP1 plus at least two of the others.

Two things follow from the wording. WP1 points at WK3, WK4, WK5, WK6 and WK8 —
engineering fundamentals, specialist knowledge, design, practice, and research
literature. It does not point at WK2, which is the maths one. So adding
equations for the sake of it will not satisfy WP1. What satisfies it is
analysis the problem forces on you.

The second thing is that WP3 is where this project currently falls short. A
booking form has an obvious solution. That is what the supervisor is reacting
to, and everything below is aimed at fixing it without changing projects.

---

## 2. The main result

The interesting thing about this system is that the feature it exists to
provide is the thing that makes the problem hard.

Suppose every student names one room and one start time, and the system only
says yes or no. Then picking the best set of bookings is a known problem with
a fast exact answer: it is maximum-weight independent set in an interval
graph, and it runs in O(n log n) (Golumbic, 1980).

Now allow the system to satisfy a request with any one of several possible
slots. That is objective 3 — the recommendation engine. The problem becomes
the Job Interval Selection Problem, which is NP-hard. It stays hard even when
each request has only two options to choose from (Spieksma, 1999).

So the sentence to say out loud in the viva is this:

> Offering the student an alternative is not a convenience feature. It is the
> step that turns a problem with a fast exact solution into one that is
> NP-hard, and the rest of this chapter is about solving the hard version to a
> known factor.

That is WP3, and it happens to be true.

---

## 3. Writing the problem down

### 3.1 What the symbols mean

| Symbol | Meaning |
|---|---|
| 𝓡 | the set of booking requests, one written r |
| 𝓕 | the set of facilities, one written f |
| 𝓣 | time slots, 30 minutes each, one written t |
| κ(f), κ_r | category of facility f, and the category r asked for |
| cap(f) | how many people facility f holds |
| p_r, d_r, σ_r | party size, duration, and wanted start time of request r |

The rules for a facility, ρ(f) = (open, close, minDur, maxDur, adv, notice),
come from the two-level model already built: the category holds every value and
a facility can override any of them. This matters more than it looks. ρ(f) is
what decides which bookings are even allowed, so the rule model is part of the
maths, not just a screen in the admin panel.

### 3.2 The options open to each request

For request r, the set of things the system could legally give it is

    𝓘(r) = { (f,t) : κ(f) = κ_r,  p_r ≤ cap(f),
                     open(f) ≤ t,  t + d_r ≤ close(f),
                     minDur(f) ≤ d_r ≤ maxDur(f),
                     t ≤ now + adv(f) }

### 3.3 The programme

Let x_{r,f,t} be 1 if request r gets facility f starting at slot t, and 0
otherwise. Let u_{r,f,t} be the score the recommender gives that pairing, a
number between 0 and 1. Section 5 replaces the current hand-picked score with
a learned one.

    maximise    Σ_{r∈𝓡}  Σ_{(f,t)∈𝓘(r)}  u_{r,f,t} · x_{r,f,t}

    subject to
      (C1)  Σ_{(f,t)∈𝓘(r)} x_{r,f,t}  ≤  1                      for every r
      (C2)  Σ_{r} Σ_{t : τ ∈ [t, t+d_r)} x_{r,f,t}  ≤  1        for every f and τ
      (C3)  x_{r,f,t} ∈ {0,1}

C1 says each student gets at most one booking. C2 says no room is given to two
people at once. C3 makes every choice a yes or no, which is what makes this an
integer programme rather than an easy one.

Worth pointing out in the report: C2 shows up twice in this project. Once here
as a line of algebra, and once in PostgreSQL as the `tstzrange` exclusion
constraint. The database constraint is how C2 gets enforced at runtime.

---

## 4. Why it is hard

**Theorem 1.** Deciding this problem is NP-hard, and finding the best answer is
hard to even approximate closely.

*Proof.* Take the special case where every score is 1, there is only one
category, and every room is big enough for every group, so no capacity or
policy rule bites. Each request is then a job with a set of possible intervals
𝓘(r). Each facility is a machine. C2 says the intervals chosen on one machine
must not overlap. The objective counts how many requests got served. That is
exactly the Job Interval Selection Problem. Several machines reduce to one by
laying the machine timelines end to end (Chuzhoy, Ostrovsky and Rabani, 2006).
JISP is NP-hard, and the version where each job has only two candidate
intervals is MAX SNP-hard (Spieksma, 1999). A special case being hard makes the
general problem hard. ∎

**Theorem 2 (where the difficulty starts).** If every request has exactly one
option, the problem is easy.

*Proof.* With one option per request, the job is to pick the highest-scoring
set of non-overlapping intervals on each facility separately. That is
maximum-weight independent set in an interval graph, which has an O(n log n)
dynamic programme (Golumbic, 1980). ∎

The pair of theorems is the contribution. They pin down exactly where the
difficulty enters, and it enters at the feature the whole project is built
around.

---

## 5. The algorithm, and what it guarantees

The system needs two ways of allocating, and the difference between them is
worth a paragraph of its own in Chapter 3.

**Live mode, which is what the system does now.** Requests are decided the
moment they arrive, first come first served. No constant-factor guarantee is
possible against the best offline answer. That is a finding rather than a
weakness: first come first served costs the university utilisation, and it
favours whoever refreshes the page fastest.

**Batch mode, to be added.** Requests that come in during a window — say, for
next week — get allocated together. Run this greedy rule: repeatedly pick,
among all options that do not clash with something already given out, the one
that finishes earliest.

What that buys:

- Counting served requests, this greedy rule is a 2-approximation for any JISP
  instance (Spieksma, 1999; the rule also appears in Adler et al., 1998). It
  always serves at least half as many requests as the best possible answer.
- With scores rather than counts, which is the real case, a 2-approximation for
  the weighted multi-machine problem comes from the local-ratio and primal-dual
  algorithms of Bar-Noy et al. (2001) and Berman and DasGupta (2000).
- The best known result for JISP is e/(e−1), under 1.582 (Chuzhoy, Ostrovsky
  and Rabani, 2006). Cite it as the state of the art. Do not try to implement
  it.

One thing to check before submitting. The 2-approximation above is taken from
the related-work section of Chuzhoy et al., which is a trustworthy source but
not the original. Read Spieksma (1999) yourself and confirm the exact form of
the greedy rule and the conditions on the bound.

---

## 6. Replacing the score with a bandit

### 6.1 What is wrong with the current score

Right now the recommender computes

    S = w₁·T + w₂·C + w₃·U

and nudges the weights after each accepted suggestion:

    w_k ← (w_k + η·d_k) / Σⱼ (wⱼ + η·dⱼ),   η = 0.05

Nothing is being estimated, there is no measure of how sure the system is, and
there is no limit on how much value is lost while the weights are still wrong.
A panel reads that as three numbers someone picked.

### 6.2 LinUCB

Give every option a = (f,t) for request r a feature vector x_{r,a} holding the
terms already computed plus a few more:

    x = [ T, C, U, lead time, party-size ratio, day-of-week indicators ]

Assume the chance the student accepts a suggestion is linear in those
features, so the expected reward is θ*ᵀx, with reward 1 if the suggestion gets
booked and 0 if not.

Keep, for each student,

    A = λI + Σ x xᵀ        b = Σ reward · x        θ̂ = A⁻¹ b

and pick

    a* = argmax_a  [ θ̂ᵀ x_{r,a}  +  α · sqrt( x_{r,a}ᵀ A⁻¹ x_{r,a} ) ]

The first term is the predicted chance of acceptance. The second is how
uncertain that prediction is, so the algorithm leans toward options it has not
tried much. That is what makes it learn instead of just repeating itself.

How well it does is bounded. With α chosen properly, LinUCB has regret
Õ( sqrt( T d ln³(KT ln T / δ) ) ) with probability 1−δ (Chu, Li, Reyzin and
Schapire, 2011). The related OFUL algorithm gets Õ(d sqrt(T))
(Abbasi-Yadkori, Pál and Szepesvári, 2011). Read whichever one you decide to
quote before you quote it.

This is the right method here rather than a fashionable one, and the reason is
already in your literature review. Roy and Dutta (2022) show that
collaborative filtering falls apart under cold start and sparse data. A bandit
is the standard answer to exactly that: the λI term acts as a prior, so a
student with no history gets sensible defaults and the estimate sharpens as
bookings accumulate. The citation you already have now justifies a real
algorithm instead of a heuristic.

It also joins up with section 3. The score u_{r,f,t} in the programme stops
being three fixed weights and becomes θ̂ᵀx, a learned value with an error bar.
The optimisation and the learning become one system rather than two.

---

## 7. No-shows

You already record attendance and do nothing numerical with it.

### 7.1 Working out how likely a student is to miss

For student i with n_i past bookings, of which n_i^miss were missed, put a Beta
prior on the no-show probability and take the posterior:

    p_i | data  ~  Beta( a₀ + n_i^miss ,  b₀ + n_i − n_i^miss )

    p̂_i = ( a₀ + n_i^miss ) / ( a₀ + b₀ + n_i )

With a₀ = 1 and b₀ = 4 the prior sits at 0.2, so a student with no history is
pulled toward the cohort average rather than assumed reliable. Cold start
again, solved the same way, which is a nice consistency to point out.

### 7.2 Overbooking rooms that hold several people

Say a facility has c places in a slot and b bookings are confirmed, each person
turning up independently with probability q = 1 − p̂. The number who show up is
N ~ Binomial(b, q).

Pick b to get the most attendance without much risk of turning people away:

    maximise    E[ min(N, c) ]
    subject to  P( N > c )  ≤  α

**Lemma.** P(Binomial(b,q) > c) never goes down as b goes up.

*Proof.* Build Binomial(b+1,q) from Binomial(b,q) by adding one more
independent coin flip. The larger count is never smaller than the smaller one,
so its tail probability cannot be lower. ∎

Because of that, every b up to some point is allowed and everything past it is
not, so the answer is

    b* = max { b :  Σ_{k=c+1}^{b} C(b,k) q^k (1−q)^{b−k}  ≤  α }

found by counting upward until the sum crosses α. Report E[min(N,c)] at b*
against the baseline b = c to show how much extra use you recover.

### 7.3 Releasing single-occupancy rooms instead

Overbooking a two-person discussion room would be unacceptable, so those get a
release rule instead. Let c_e be the cost of an empty room-hour and c_d the
cost of turning away a student who did show up. Releasing the booking to the
waitlist τ minutes before the start is the cheaper choice when

    p̂ · c_e  >  (1 − p̂) · c_d        which rearranges to        p̂  >  c_d / (c_d + c_e)

That is the Bayes decision rule for choosing between two actions when the two
kinds of mistake cost different amounts. One line of algebra, and it turns
attendance data you already collect into an actual decision the system makes.

---

## 8. Tests that need no students

This is the part that takes the pressure off Phase 2, because none of it needs
a participant.

Generate instances: n requests from 10 up to 200, m facilities in {3, 7, 15},
three levels of contention set by bunching wanted start times around peak
hours, 30 random seeds each.

Run three things on the same instances:

1. Live first-come-first-served greedy, which is the current system.
2. Batch earliest-finishing-time greedy, the 2-approximation.
3. The exact answer from an integer programming solver such as CBC or HiGHS,
   through PuLP or OR-Tools, for sizes small enough to finish.

Then report:

| What you measure | Why it matters |
|---|---|
| ALG / OPT against n and contention | how close greedy gets in practice, against the proven half |
| Use lost by first come first served | puts a number on the fairness argument in Chapter 1 |
| Solver time against n | shows where exact answers stop being possible, which justifies the heuristic |
| Bandit regret against sqrt(T) | shows the learning behaves the way the bound says |

Expect batch greedy to land well above half in practice. That is worth saying
plainly: the worst case is built by an adversary, and campus demand is not
adversarial.

---

## 9. What this covers

| Piece | WK | WP |
|---|---|---|
| The integer programme | WK2, WK3 | WP1, WP3 |
| NP-hardness and the interval-graph boundary | WK2, WK4, WK8 | WP1, WP3, WP4 |
| Greedy allocator and its ratio | WK3, WK4 | WP1, WP3 |
| Optimality-gap experiment | WK2, WK6 | WP3 |
| LinUCB and its regret bound | WK4, WK8 | WP1, WP4 |
| Overbooking and release rule | WK2, WK4 | WP2 |
| Rule inheritance, schema, row level security | WK5, WK6 | WP7 |
| Three roles with conflicting needs | WK7 | WP2, WP6 |
| PDPA, BEM conduct, safety, sustainability | WK7 | WP5 |

WP1 is covered through WK3, WK4 and WK8. WP3 is covered by the two theorems.
WP2, WP4, WP6 and WP7 come along with them, which clears the WP1-plus-two bar
with room to spare.

---

## 10. What has to change

In the report, Chapter 3 gains a formulation section holding the programme,
both theorems and the approximation result. Chapter 2 gains a short piece on
interval scheduling and bandits, which also helps WK8. Objective 3 gets
restated: build an allocation mechanism with a stated approximation guarantee
and a learned score, rather than an engine that ranks and learns. Objective 5
picks up the optimality gap and the regret curve as things you measure. That is
roughly 1,200 words in, so something has to come out to stay under 10,000, and
Chapter 2 is the place to cut.

In the code: a batch allocation mode, the LinUCB update replacing
`updateWeights` in `src/lib/recommend.ts`, a no-show probability computed over
the attendance data already there, and the release rule as a scheduled job. The
instance generator and the solver comparison live outside the app in a scripts
folder.

One warning. None of this can live only in the report. The panel will ask
whether the software actually does it, so every result above has to be
reachable from the running system.

---

## 11. References to add

- Abbasi-Yadkori, Y., Pál, D., & Szepesvári, C. (2011). Improved algorithms for
  linear stochastic bandits. *Advances in Neural Information Processing
  Systems*, 24, 2312–2320.
- Adler, M., Rosenberg, A. L., Sitaraman, R. K., & Unger, W. (1998). Scheduling
  time-constrained communication in linear networks. *Proceedings of the 10th
  Annual ACM Symposium on Parallel Algorithms and Architectures*, 269–278.
- Bar-Noy, A., Bar-Yehuda, R., Freund, A., Naor, J., & Schieber, B. (2001). A
  unified approach to approximating resource allocation and scheduling.
  *Journal of the ACM*, 48(5), 1069–1090.
- Berman, P., & DasGupta, B. (2000). Improvements in throughput maximization
  for real-time scheduling. *Proceedings of the 32nd Annual ACM Symposium on
  Theory of Computing*, 680–687.
- Chu, W., Li, L., Reyzin, L., & Schapire, R. E. (2011). Contextual bandits with
  linear payoff functions. *Proceedings of the 14th International Conference on
  Artificial Intelligence and Statistics*, 208–214.
- Chuzhoy, J., Ostrovsky, R., & Rabani, Y. (2006). Approximation algorithms for
  the job interval selection problem and related scheduling problems. *Journal
  of Algorithms*. Earlier version in *Proceedings of the 42nd Annual IEEE
  Symposium on Foundations of Computer Science*, 2001, 348–356.
- Engineering Accreditation Council. (2020). *Engineering programme
  accreditation standard 2020*. Board of Engineers Malaysia.
- Garey, M. R., & Johnson, D. S. (1977). Two processor scheduling with start
  times and deadlines. *SIAM Journal on Computing*, 6(3), 416–426.
- Golumbic, M. C. (1980). *Algorithmic graph theory and perfect graphs*.
  Academic Press.
- Nakajima, K., & Hakimi, S. L. (1982). Complexity results for scheduling tasks
  with discrete starting times. *Journal of Algorithms*, 3(4), 344–361.
- Spieksma, F. C. R. (1999). On the approximability of an interval scheduling
  problem. *Journal of Scheduling*, 2(5), 215–227.

Check every one against the publisher before it goes in the reference list, the
same way the original eleven were checked.
