/-
Lean snippets for the notes site, referenced by anchor name from
`\verso{name}` macros in `.tree` files. Each region between
`-- ANCHOR: name` and `-- ANCHOR_END: name` is rendered by Verso into
`build/verso/<name>.html` and spliced into the Forester HTML output.
-/

import Mathlib.Data.Nat.Basic
import Mathlib.Data.List.Basic

-- ANCHOR: nat_succ
example (n : Nat) : n + 1 = Nat.succ n := rfl
-- ANCHOR_END: nat_succ

-- ANCHOR: list_map
example : [1, 2, 3].map (· + 1) = [2, 3, 4] := rfl
-- ANCHOR_END: list_map
