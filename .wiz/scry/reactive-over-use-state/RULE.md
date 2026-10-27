---
version: 0.0.51
---
# Reactive over useState

An interaction with several moving parts is a piece of logic, and logic belongs
in a plain class you can read, test and call without a renderer. Give the class
a `Dispatcher` from `webappwiz/events`, dispatch when its state changes, and
let the component read a projection of it through `useReactive`. `useState`
stays for what it is good at: one local, self contained value nothing else
cares about. Once two pieces of state have to agree, or an effect exists to
keep them in step, the component is modeling the logic and the class should be. This rule is
about state kept in step; whether a component decides things at all is
what logic-lives-in-controllers asks.

Its cases are in `evals/`: each `.good.` file follows the rule, and each
`.bad.` file breaks it.
