import type { ButtonHTMLAttributes, ReactNode } from 'react'

type Variant = 'primary' | 'secondary'

export function Button({
  variant = 'secondary',
  className,
  children,
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & { children: ReactNode; variant?: Variant }) {
  return (
    <button className={`xmds-btn xmds-btn-${variant}${className ? ` ${className}` : ''}`} {...props}>
      {children}
    </button>
  )
}
