# SeatPlan share bundle

This bundle contains a source snapshot of the independent SeatPlan project at commit `f2f133b3b35247392a1d5048cbc1b2e864cb574d` (`Add shareable event invitation codes`), plus the Liquid Glass design prompt and the supplied reference component.

## Included work
- Event invitation codes are generated alongside organizer share links and can be copied from event settings.
- Participants can enter a code at the participant entry page; existing invitation links continue to work.
- Regenerating an event invitation invalidates its old link and code.
- The supplied LiquidGlassWordmarkFooter snippet was attached twice and both copies were identical, so this bundle includes one reference copy.
- `PROMPT_LIQUID_GLASS_REDESIGN.md` contains the ready-to-paste prompt for the visual redesign and unified style across organiser and participant screens.

## Deployment status at packaging
The invitation-code commit is in GitHub main. Vercel marked the production deployment `BLOCKED` by team configuration, so the code was not confirmed live on the public site when this bundle was made.

## Model suggestion
For the multi-file visual update, use GPT-6.2 Astra with High reasoning if available in Codex; otherwise use GPT-6.1 Terra High.

## Safety
This source snapshot excludes `.git`, node_modules, local environment files and build caches. `.env.example` is a template only.
