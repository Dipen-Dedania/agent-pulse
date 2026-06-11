/**
 * FAQ — §4.13
 * Native <details>/<summary> accordion for free keyboard + screen-reader
 * accessibility. Each item is a white card with a hairline border.
 * The chevron indicator rotates when the details element is open via
 * the CSS `group-open:` modifier.
 */
import { faqItems } from '../data/faq';

export default function FAQ() {
  return (
    <section id="faq" className="py-20">
      <div className="mx-auto max-w-[720px] px-6">
        {/* Section title */}
        <h2 className="mb-12 text-center text-heading font-bold text-midnight-navy max-md:text-heading-sm">
          Questions, answered
        </h2>

        {/* Accordion items */}
        <div className="flex flex-col gap-3">
          {faqItems.map((item) => (
            <details
              key={item.question}
              className="group rounded-cards border border-mist-border bg-paper shadow-sm"
            >
              {/* Question row */}
              <summary
                className={[
                  'flex cursor-pointer list-none items-center justify-between gap-4 px-6 py-5',
                  'text-body-sm font-semibold text-midnight-navy',
                  /* Remove default disclosure marker across browsers */
                  '[&::-webkit-details-marker]:hidden',
                ].join(' ')}
              >
                <span>{item.question}</span>

                {/* Chevron — rotates 180° when open */}
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="shrink-0 text-steel-blue transition-transform duration-200 group-open:rotate-180"
                  aria-hidden
                >
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </summary>

              {/* Answer */}
              <p className="px-6 pb-6 text-body-sm text-slate-blue">{item.answer}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
