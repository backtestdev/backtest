import {
  SignInButton,
  SignUpButton,
  UserButton,
  SignedIn,
  SignedOut,
} from "@clerk/nextjs";
import Navigation from "@/components/Navigation";
import AutoRefresh from "@/components/AutoRefresh";

export default function AppLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <>
      <nav className="sticky top-0 z-50 relative flex justify-between items-center px-4 sm:px-6 py-3 border-b border-th-border-light bg-th-surface/95 backdrop-blur-sm shadow-sm">
        <Navigation />
        <div className="flex items-center gap-2 sm:gap-3">
          <SignedOut>
            <SignInButton mode="modal">
              <button className="px-3 sm:px-4 py-2 text-sm font-medium text-th-text-2 hover:text-th-text border border-th-border rounded-lg hover:bg-th-hover transition-colors">
                Sign In
              </button>
            </SignInButton>
            <SignUpButton mode="modal">
              <button className="px-3 sm:px-4 py-2 text-sm font-medium text-white bg-th-accent rounded-lg hover:bg-th-accent-hover transition-colors">
                Create Free Account
              </button>
            </SignUpButton>
          </SignedOut>
          <SignedIn>
            <UserButton />
          </SignedIn>
        </div>
      </nav>
      <AutoRefresh />
      {children}
    </>
  );
}
