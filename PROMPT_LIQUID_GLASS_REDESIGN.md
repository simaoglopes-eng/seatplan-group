# Codex prompt: SeatPlan Liquid Glass redesign

Implement this directly in my independent SeatPlan repository. Do not stop at an audit or a plan.

## First inspect
Read the repository guidance and project notes that exist, especially AGENTS.md, LEGGIMI_FEDERICO.md, INDEPENDENT_PROJECT.md, INDEPENDENT_SETUP.md, and docs/design-system.md. Work only in the independent SeatPlan repository. Do not change the Martin/restaurant project, database or email configuration, and do not deploy or publish.

## Goal
Refine SeatPlan into a polished, high-end product. The welcome page must clearly present two equal paths: “I’m an organiser” and “I’m a participant”. Keep the interface copy in English, preserve SeatPlan branding, existing routes, account flows, APIs and working interactions.

## Use the attached code as a reference
The two supplied files are duplicate copies of LiquidGlassWordmarkFooter. This is a footer, not a role menu. Use only its visual language: translucent glass, backdrop blur, light-catching edges, subtle refraction, pointer-responsive highlights and restrained press ripples. Do not copy the full footer, 3D wordmark, newsletter, demo content, external photographs or remote URLs.

The repository is a React/Vite/TypeScript app with its own CSS design tokens and an existing LiquidGlassPanel. It does not use shadcn or Tailwind. Do not scaffold another app or introduce those frameworks. Start from the current implementation.

## Inspect and update
Review Home.tsx, ParticipantStartPage.tsx, LiquidGlassPanel.tsx, PageShell.tsx, tokens.css, premium.css, home.css, OrganiserDashboard.tsx, the organiser event workspace, login/registration, participant join, floor-plan editor, and their stylesheets.

- Refine the existing two-choice welcome interface. Keep organiser registration at /organiser/register and participant entry at /participant.
- Keep participant entry compatible with both existing invitation links and short invitation codes.
- Build a small reusable glass-surface treatment and shared tokens. Apply a coherent design language across welcome, participant, login and registration, organiser dashboard, event workspace, floor-plan editor, and the shared PageShell.
- Keep layouts appropriate to each task. The organiser screens are working interfaces: maps, seats, forms and status information must remain crisp, legible and easy to operate. Do not place blur or distortion over the seat map or controls.

## Visual direction
Use a warm, luxurious editorial style: ivory and champagne surfaces, charcoal ink, restrained bronze or terracotta accents, elegant display typography and highly readable interface text. Remove dominant green brand surfaces while preserving accessible semantic status colors.

Make the glass effect visibly convincing, not just an opaque card with transparency: use layered fill, real backdrop blur, fine edge highlights, soft inner light and subtle pointer-driven refraction. Add a restrained press response. Keep text and controls sharp above the material. Preserve the current background unless you find a concrete problem; adjust its crop and overlay to reveal the glass.

## Quality requirements
- Respect reduced-motion and reduced-transparency preferences; provide graceful fallbacks where blur or refraction is unsupported.
- Make controls discoverable without hover; support keyboard, touch, visible focus and accessible contrast.
- Make the menu and organiser experience work well on phone and desktop.
- Keep effects lightweight. Do not add Three.js, GSAP, shadcn, Tailwind or other heavy packages just to reproduce the attached footer. If a dependency is truly necessary, justify it before adding it.
- Do not change business logic, API contracts, authentication, database schema, email settings, participant invitation-code behavior or unrelated screens.
- Do not add mock/demo product data. Do not commit, push or deploy.

Implement the changes, inspect the final diff, and run the frontend production build/typecheck with npm run build in frontend. Do not run the full test suite. Summarize visual changes, main files touched, build result and remaining limitations.
