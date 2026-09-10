import { notFound } from 'next/navigation'
import { GradientReview } from '@/components/lab/GradientReview'

export default function GradientReviewPage() {
  if (process.env.NODE_ENV !== 'development') notFound()
  return <GradientReview />
}
