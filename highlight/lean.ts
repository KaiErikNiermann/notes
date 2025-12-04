import type { LanguageFn, Mode } from 'highlight.js';

const LEAN_IDENT_RE = /[A-Za-z_][\w\u207F-\u209C\u1D62-\u1D6A\u2079']*/;

const KEYWORDS = {
    keyword:
        // Declarations
        'def theorem lemma class instance structure example inductive coinductive ' +
        'axiom constant universe variable parameter ' +
        // Modifiers
        'private protected noncomputable partial unsafe ' +
        'mutual where deriving extends ' +
        // Tactics & proof
        'by calc match with do let in have show from suffices ' +
        'fun assume if then else ' +
        // Imports & namespaces
        'import open export namespace section end ' +
        'set_option attribute ' +
        // Other
        'return pure throw catch finally for unless macro syntax elab ',
    built_in:
        // Types
        'Type Prop Sort ' +
        'Nat Int Bool List Option String IO Unit Empty PUnit ' +
        'Array Subtype Sigma PSigma Prod Sum Fin ' +
        'Decidable Inhabited Nonempty ' +
        'StateT ReaderT ExceptT OptionT ' +
        'Monad Functor Applicative ' +
        // Common tactics
        'rw rewrite rwa erw subst ' +
        'simp simp_all dsimp simpa simp_intros norm_num ring linarith omega nlinarith polyrith ' +
        'unfold unfold_let delta ' +
        'intro intros rintro rcases obtain cases induction ' +
        'exact exacts refine apply fapply eapply apply_instance ' +
        'constructor econstructor use exists existsi ' +
        'left right split injection injections ext funext ' +
        'refl rfl symm trans congr congr_arg ' +
        'contradiction exfalso absurd ' +
        'assumption trivial decide ' +
        'generalize specialize revert clear rename ' +
        'infer_instance inferInstance ' +
        'repeat try first all_goals any_goals focus done sorry admit ' +
        'conv conv_lhs conv_rhs arg ext enter ' +
        'aesop tauto decide_eq push_neg contrapose ' +
        'norm_cast push_cast ' +
        'field_simp ring_nf ' +
        'positivity continuity measurability ',
    literal:
        'true false'
};

const ATTRIBUTE_DECORATOR: Mode = {
    className: 'meta',
    begin: /@\[/,
    end: /\]/,
    contains: [
        {
            className: 'keyword',
            begin: /\w+/
        }
    ]
};

const ATTRIBUTE_MODE: Mode = {
    className: 'meta',
    begin: /@[A-Za-z_][A-Za-z0-9_.]*/
};

const QUOTED_NAME_MODE: Mode = {
    className: 'symbol',
    begin: /`[A-Za-z_][A-Za-z0-9_.']*/
};

const COMMAND_MODE: Mode = {
    className: 'meta',
    begin: /#(check|eval|reduce|print|print_axioms|help|guard|guard_msgs|norm_num|simp|synth|where|minimize_imports|check_simp|check_tactic)\b/,
    end: /(?=--)|$/,
    excludeEnd: true
};

const HOLE_MODE: Mode = {
    className: 'meta',
    begin: /\?[A-Za-z_]?\w*/
};

const PLACEHOLDER_MODE: Mode = {
    className: 'meta',
    begin: /_/,
    relevance: 0
};

const CHAR_MODE: Mode = {
    className: 'string',
    begin: /'(?:\\.|[^\\'])'/,
    relevance: 0
};

const OPERATOR_MODE: Mode = {
    className: 'operator',
    begin: /:=|::|≫=|>>=|\*\*|->|←|→|↔|⟶|⟷|=>|⇒|λ|∀|∃|Π|≤|≥|≠|≈|≡|∈|∉|⊆|⊇|⊂|⊃|∪|∩|⊕|⊗|⊖|⊔|⊓|⊤|⊥|∧|∨|¬|⊢|⊣|⊨|⟨|⟩|⟪|⟫|∑|∏|⨁|∘|∙|×|÷|±|∞|∂|∇|√|∫|⋃|⋂|⟹|⟺|↦|↪|↠|⤳|≃|≅|≊|≋|∼|≺|≻|⊏|⊐|▸|◂|▹|◃|⬝|⁻¹|⬛|▪|•|·|†|‡/,
    relevance: 0
};

const lean: LanguageFn = (hljs: any) => {
    const LINE_COMMENT = hljs.COMMENT(/--/, /$/);
    const BLOCK_COMMENT = hljs.COMMENT(/\/-/, /-\//, { contains: ['self'] });
    const DOC_COMMENT: Mode = {
        className: 'doctag',
        begin: /\/--/,
        end: /-\//
    };

    const STRING_MODE = hljs.QUOTE_STRING_MODE;
    const NUMBER_MODE = hljs.NUMBER_MODE;

    const DEFINITION_MODE: Mode = {
        className: 'function',
        beginKeywords: 'def theorem lemma class instance structure inductive abbrev',
        end: /(:=|where|$)/,
        excludeEnd: true,
        contains: [
            {
                className: 'title.function',
                begin: LEAN_IDENT_RE,
                relevance: 0
            },
            {
                className: 'params',
                begin: /[([{⦃⟨]/,
                end: /[)\]}⦄⟩]/,
                endsParent: false,
                keywords: KEYWORDS,
                contains: [
                    LINE_COMMENT,
                    BLOCK_COMMENT,
                    STRING_MODE,
                    NUMBER_MODE,
                    OPERATOR_MODE,
                    'self'
                ]
            }
        ],
        keywords: KEYWORDS
    };

    const sharedModes: Mode[] = [
        DOC_COMMENT,
        LINE_COMMENT,
        BLOCK_COMMENT,
        STRING_MODE,
        CHAR_MODE,
        NUMBER_MODE,
        ATTRIBUTE_DECORATOR,
        ATTRIBUTE_MODE,
        COMMAND_MODE,
        QUOTED_NAME_MODE,
        HOLE_MODE,
        PLACEHOLDER_MODE,
        OPERATOR_MODE
    ];

    const BEGIN_BLOCK: Mode = {
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
        contains: [DEFINITION_MODE, ...sharedModes, BEGIN_BLOCK]
    };
};

export default lean;
