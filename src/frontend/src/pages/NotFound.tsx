import { useSeoMeta } from '@unhead/react';
import { Link } from 'react-router-dom';
import { ArrowLeft, FileQuestion } from 'lucide-react';
import { AppShell } from '@/components/product';
import { Button } from '@/components/ui/button';

const NotFound = () => {
  useSeoMeta({ title: 'Page not found · Just Ask BIPs', description: 'The requested page is not part of the current BIP research index.' });
  return <AppShell><main className="mx-auto grid min-h-[65vh] max-w-3xl place-items-center px-4 py-16 text-center"><div><span className="mx-auto grid size-16 place-items-center rounded-2xl bg-blue-50 text-[#2563EB]"><FileQuestion className="size-8" /></span><p className="mt-6 font-mono text-sm font-bold text-[#2563EB]">404 / RECORD NOT FOUND</p><h1 className="mt-3 text-4xl font-semibold tracking-tight">This path is not in the index.</h1><p className="mx-auto mt-4 max-w-lg text-lg leading-8 text-[#6B7280]">Return to the proposal explorer to continue researching Bitcoin consensus history.</p><Button asChild className="mt-7 bg-[#2563EB]"><Link to="/explore"><ArrowLeft /> Back to Explore</Link></Button></div></main></AppShell>;
};
export default NotFound;
