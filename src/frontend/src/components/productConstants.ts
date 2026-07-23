import type { SentimentChoice } from '@/api/apiClient';


export const sentimentLabel: Record<SentimentChoice, string> = {
  For: 'Good for Bitcoin',
  Neutral: 'Not sure yet',
  Against: 'Not good for Bitcoin',
};

export const voteButtonChoiceStyle: Record<SentimentChoice, string> = {
  For: 'data-[selected=true]:border-[#16A34A] data-[selected=true]:bg-[#F0FBF2] data-[selected=true]:text-[#166534]',
  Neutral: 'data-[selected=true]:border-[#6B7280] data-[selected=true]:bg-[#F3F4F6] data-[selected=true]:text-[#374151]',
  Against: 'data-[selected=true]:border-[#DC2626] data-[selected=true]:bg-[#FDF2F2] data-[selected=true]:text-[#991B1B]',
};
