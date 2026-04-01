import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'
import rehypeHighlight from 'rehype-highlight'

export function TextBlock({ text }: { text: string }) {
  return (
    <div className="prose prose-neutral dark:prose-invert max-w-none font-sans prose-p:my-1 prose-headings:mt-3 prose-headings:mb-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0 prose-pre:my-1.5 prose-table:my-1.5 prose-blockquote:my-1.5 prose-hr:my-2 [&>*+*]:mt-1">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        rehypePlugins={[rehypeHighlight]}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
}
