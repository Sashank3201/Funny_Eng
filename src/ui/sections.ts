import { content, contentIsPlaceholder, type Project } from '../content';

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** A short mono label with a rule, used to open every section. */
function sectionLabel(text: string, index: string): HTMLElement {
  const wrap = el('div', 'label');
  wrap.append(el('span', 'label__index', index), el('span', 'label__text', text));
  return wrap;
}

function projectCard(project: Project, index: number): HTMLElement {
  const card = el('article', 'project reveal');
  card.style.setProperty('--i', String(index));

  const head = el('header', 'project__head');
  const title = el('h3', 'project__title', project.title);
  if (project.example) {
    // Tagged in the markup, not just the data — anyone reading the page can
    // see at a glance that this is a layout demonstration, not a claim.
    const tag = el('span', 'project__tag', 'Example');
    title.append(' ', tag);
  }
  head.append(title, el('span', 'project__period', project.period));

  const meta = el('p', 'project__role', project.role);
  const summary = el('p', 'project__summary', project.summary);

  const stack = el('ul', 'stack');
  for (const item of project.stack) stack.append(el('li', 'stack__item', item));

  card.append(head, meta, summary, stack);

  if (project.metric) {
    card.append(el('p', 'project__metric', project.metric));
  }

  if (project.links?.length) {
    const links = el('div', 'project__links');
    for (const link of project.links) {
      const a = el('a', 'link', link.label);
      a.href = link.href;
      if (/^https?:/.test(link.href)) {
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
      }
      links.append(a);
    }
    card.append(links);
  }

  return card;
}

export function renderSections(root: HTMLElement): void {
  const { hero, work, about, contact, meta, readout } = content;

  // ---- Hero --------------------------------------------------------------
  const heroSection = el('section', 'section section--hero');
  heroSection.id = 'hero';
  const heroInner = el('div', 'section__inner');
  heroInner.append(
    el('p', 'hero__eyebrow reveal', hero.eyebrow),
    el('h1', 'hero__name reveal', hero.headline),
    el('p', 'hero__standfirst reveal', hero.standfirst),
  );

  const actions = el('div', 'hero__actions reveal');
  for (const action of hero.actions) {
    const a = el('a', action.primary ? 'btn btn--primary' : 'btn', action.label);
    a.href = action.href;
    actions.append(a);
  }
  heroInner.append(actions);
  heroSection.append(heroInner);

  // ---- Work --------------------------------------------------------------
  const workSection = el('section', 'section section--work');
  workSection.id = 'work';
  const workInner = el('div', 'section__inner');
  workInner.append(
    sectionLabel(work.label, '01'),
    el('p', 'section__intro reveal', work.intro),
  );
  const grid = el('div', 'projects');
  work.projects.forEach((p, i) => grid.append(projectCard(p, i)));
  workInner.append(grid);
  workSection.append(workInner);

  // ---- About -------------------------------------------------------------
  const aboutSection = el('section', 'section section--about');
  aboutSection.id = 'about';
  const aboutInner = el('div', 'section__inner');
  aboutInner.append(sectionLabel(about.label, '02'));

  const prose = el('div', 'prose reveal');
  for (const paragraph of about.paragraphs) prose.append(el('p', undefined, paragraph));
  aboutInner.append(prose);

  const skills = el('dl', 'skills reveal');
  for (const group of about.skills) {
    skills.append(el('dt', 'skills__label', group.label));
    skills.append(el('dd', 'skills__items', group.items.join(' · ')));
  }
  aboutInner.append(skills);
  aboutSection.append(aboutInner);

  // ---- Contact -----------------------------------------------------------
  const contactSection = el('section', 'section section--contact');
  contactSection.id = 'contact';
  const contactInner = el('div', 'section__inner');
  contactInner.append(
    sectionLabel(contact.label, '03'),
    el('p', 'contact__headline reveal', contact.headline),
  );

  const mail = el('a', 'contact__email reveal', contact.email);
  mail.href = `mailto:${contact.email}`;
  contactInner.append(mail);

  const socials = el('nav', 'contact__socials reveal');
  socials.setAttribute('aria-label', 'Elsewhere');
  for (const social of contact.socials) {
    const a = el('a', 'link', social.label);
    a.href = social.href;
    if (/^https?:/.test(social.href)) {
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
    }
    socials.append(a);
  }
  contactInner.append(socials);

  const footer = el('footer', 'colophon');
  footer.append(
    el('span', undefined, `© ${new Date().getFullYear()} ${meta.name}`),
    el('span', undefined, readout.label),
  );
  contactInner.append(footer);
  contactSection.append(contactInner);

  root.append(heroSection, workSection, aboutSection, contactSection);

  // The page says plainly when it is still running on placeholder copy, rather
  // than dressing invented projects up as real ones.
  if (contentIsPlaceholder) {
    const notice = el('p', 'placeholder-notice');
    const exampleCount = content.work.projects.filter((p) => p.example).length;
    notice.textContent = exampleCount
      ? `${exampleCount} example projects and some placeholder copy — edit src/content.ts.`
      : 'Placeholder copy remains — edit src/content.ts.';
    document.body.append(notice);
  }
}

/** Fill the fixed chrome: the mark, the nav, and the instrument readout. */
export function renderChrome(root: ParentNode): void {
  const mark = root.querySelector('[data-mark]');
  if (mark) mark.textContent = content.meta.name;

  const status = root.querySelector('[data-status]');
  if (status) {
    if (content.availability) status.textContent = content.availability;
    else status.remove();
  }

  const nav = root.querySelector('[data-nav]');
  if (nav) {
    const items: [string, string][] = [
      ['Work', '#work'],
      ['About', '#about'],
      ['Contact', '#contact'],
    ];
    nav.replaceChildren(
      ...items.map(([label, href]) => {
        const a = el('a', 'nav__link', label);
        a.href = href;
        return a;
      }),
    );
  }

  const readout = root.querySelector('[data-readout]');
  if (readout) {
    readout.replaceChildren(
      el('span', 'readout__title', content.readout.label),
      ...content.readout.lines.map((line) => el('span', 'readout__line', line)),
    );
  }
}

/** Reveal elements as they enter the viewport. */
export function observeReveals(): void {
  const targets = document.querySelectorAll<HTMLElement>('.reveal');

  if (!('IntersectionObserver' in window)) {
    targets.forEach((t) => t.classList.add('is-visible'));
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      }
    },
    { rootMargin: '0px 0px -12% 0px', threshold: 0.15 },
  );

  targets.forEach((t) => observer.observe(t));
}
