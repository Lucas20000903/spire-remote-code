import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'

export function TextBlock({ text }: { text: string }) {
  return (
    <div className="prose prose-invert max-w-none prose-pre:bg-muted prose-pre:text-foreground prose-code:text-foreground">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
}
