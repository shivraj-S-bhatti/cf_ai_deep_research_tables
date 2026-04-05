# Knowledge System

This repo uses a lightweight knowledge versioning and authority system so we can tell which artifacts are current, binding, historical, or just narrative/contextual. The `knowledge/` area is meant to hold both durable docs and hands-on investigation artifacts such as notebooks.

## Layout

- `grounding/`: source requirements and challenge text
- `context/`: decisions, board state, iteration logs, and historical analysis
- `notebooks/`: executable investigation artifacts and baseline logic mirrors
- `submission/`: draft content for the repo submission package
- `blog/`: longer-form public writeups and retrospective posts

## Required Metadata

Each durable doc should start with a `Document Metadata` section containing:

- `Doc ID`: stable identifier for the document family
- `Version`: semantic version for that document
- `Status`: one of `authoritative`, `working`, `historical`, `archived`, `flavor`
- `Kind`: short content class such as `source-text`, `decision-record`, `iteration-log`, `architecture`, `proposal`
- `Last Updated`: ISO date
- `Authority`: plain-language explanation of whether the doc is binding
- `Supersedes`: prior doc/version if applicable

## Status Meanings

- `authoritative`: current source of truth for its scope
- `working`: active draft or synthesis, useful but not binding
- `historical`: retained for context; newer docs should usually take precedence
- `archived`: superseded and not meant for active guidance
- `flavor`: inspirational, narrative, or framing text; never overrides product requirements

## Versioning Rules

- Increase `major` when the meaning or policy changes materially.
- Increase `minor` when substantive content is added or reorganized.
- Increase `patch` for wording, formatting, or metadata-only cleanup.
- Reuse the same `Doc ID` across versions of the same document family.

## Precedence Rules

1. `authoritative` beats every other status for the same scope.
2. Within the same `Doc ID`, the highest version wins unless explicitly archived.
3. If a doc says it supersedes another, follow the newer one.
4. `flavor` docs are non-binding by definition.

## Registry

The current knowledge inventory lives in [knowledge/registry.md](./registry.md).
