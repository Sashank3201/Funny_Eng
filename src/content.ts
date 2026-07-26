/**
 * Everything user-facing on the page. This is the only file you need to touch
 * to rebrand the hero.
 */
export const content = {
  /** Small label above the name. */
  eyebrow: 'Software Engineer',

  /** Your name — the page's single <h1>. */
  name: 'Sashank',

  /** One or two lines under the name. */
  tagline:
    'I build things that hold their shape under pressure — systems, interfaces, and the occasional accretion disk.',

  /** Primary and secondary calls to action. */
  actions: [
    { label: 'View work', href: '#work', primary: true },
    { label: 'Get in touch', href: 'mailto:hello@example.com', primary: false },
  ],

  /** Links in the corner of the hero. */
  links: [
    { label: 'GitHub', href: 'https://github.com/Sashank3201' },
    { label: 'LinkedIn', href: 'https://www.linkedin.com/' },
  ],

  /** Caption in the lower corner, describing what the visual actually is.
   *  Keep it short — it sits in a pill and wraps badly past two clauses. */
  caption: 'Schwarzschild geometry · relativistic beaming',
} as const;
