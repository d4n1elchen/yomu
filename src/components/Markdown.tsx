import { parseMarkdown, type Span } from '../lib/markdown.ts';

/**
 * Renders the Q&A answer's small Markdown subset.
 *
 * Every piece of text arrives as a React child, never as HTML -- React escapes
 * it, so a model that emits `<script>` produces those characters on screen and
 * nothing else. There is deliberately no `dangerouslySetInnerHTML` here, and
 * there should never be: this is untrusted model output.
 */
function Spans({ spans }: { spans: Span[] }) {
  return (
    <>
      {spans.map((span, i) =>
        span.code ? (
          <code key={i}>{span.text}</code>
        ) : span.bold ? (
          <strong key={i}>{span.text}</strong>
        ) : (
          <span key={i}>{span.text}</span>
        ),
      )}
    </>
  );
}

export function Markdown({ text }: { text: string }) {
  return (
    <div className="md">
      {parseMarkdown(text).map((block, i) => {
        if (block.kind === 'heading') {
          return (
            <p className="md-heading" key={i}>
              <Spans spans={block.spans} />
            </p>
          );
        }
        if (block.kind === 'list') {
          const items = block.items.map((item, j) => (
            <li key={j}>
              <Spans spans={item} />
            </li>
          ));
          return block.ordered ? (
            <ol key={i} start={block.start}>
              {items}
            </ol>
          ) : (
            <ul key={i}>{items}</ul>
          );
        }
        return (
          <p key={i}>
            <Spans spans={block.spans} />
          </p>
        );
      })}
    </div>
  );
}
