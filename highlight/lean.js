"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const KEYWORDS = {
    keyword: 'by calc match with if then else do fun λ forall exists ∀ ∃ let in begin end open namespace section inductive structure class instance theorem lemma def example corollary axioms axiom variable variables intro intros apply refine exact assume have show from using rewrite rw simp dsimp erw try cases generalize specialize where deriving mutual mutual_def mutual_inductive field',
    literal: 'true false tt ff',
    built_in: 'Type Prop Sort Nat Int Bool List Option String IO Vector Finite Set StateT ExceptT Fin'
};
const ATTRIBUTE_MODE = {
    className: 'meta',
    begin: /@[A-Za-z_][A-Za-z0-9_.]*/
};
const QUOTED_NAME_MODE = {
    className: 'symbol',
    begin: /`[A-Za-z_][A-Za-z0-9_.']*/
};
const COMMAND_MODE = {
    className: 'meta',
    begin: /#(check|eval|reduce|print|simp|synth)\b/,
    end: /$/
};
const HOLE_MODE = {
    className: 'meta',
    begin: /\?_?\w*/
};
const OPERATOR_MODE = {
    className: 'operator',
    begin: /:=|::|\*\*|->|←|→|↔|λ|∀|∃|≤|≥|≠|==|=|<|>|∧|∨|¬|⊢|⟨|⟩|∑|∏/,
    relevance: 0
};
const lean = (hljs) => {
    const LINE_COMMENT = hljs.COMMENT(/--/, /$/);
    const BLOCK_COMMENT = hljs.COMMENT(/\/-/, /-\//, { contains: ['self'] });
    const sharedModes = [
        LINE_COMMENT,
        BLOCK_COMMENT,
        hljs.QUOTE_STRING_MODE,
        hljs.APOS_STRING_MODE,
        hljs.C_NUMBER_MODE,
        ATTRIBUTE_MODE,
        COMMAND_MODE,
        QUOTED_NAME_MODE,
        HOLE_MODE,
        OPERATOR_MODE
    ];
    const BEGIN_BLOCK = {
        className: 'meta',
        begin: /\bbegin\b/,
        end: /\bend\b/,
        keywords: KEYWORDS,
        contains: []
    };
    BEGIN_BLOCK.contains = [...sharedModes];
    return {
        name: 'Lean',
        aliases: ['lean', 'lean4', 'lean3', 'language-lean'],
        case_insensitive: false,
        keywords: KEYWORDS,
        contains: [...sharedModes, BEGIN_BLOCK]
    };
};
exports.default = lean;
