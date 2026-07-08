/-
GENERATED FILE — do not edit by hand.
Regenerated each build by scripts/build_verso.py from anchor regions in
lean/examples/Examples.lean. Hand-edits will be lost.
-/
import VersoManual
open Verso.Genre Manual
open Verso.Genre.Manual.InlineLean
open Verso.Code.External

set_option verso.exampleProject "../examples"
set_option verso.exampleModule "Examples"

#doc (Manual) "Snippets" =>

# nat succ
%%%
file := "nat_succ"
number := false
%%%

```anchor nat_succ
example (n : Nat) : n + 1 = Nat.succ n := rfl
```

# list map
%%%
file := "list_map"
number := false
%%%

```anchor list_map
example : [1, 2, 3].map (· + 1) = [2, 3, 4] := rfl
```
