import { motion } from "framer-motion";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.5 }}
      className="min-h-screen flex flex-col"
    >
      {/* Main Content */}
      <div className="flex-1 flex flex-col items-center justify-center px-4">
        <div className="text-center">
          <p className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-primary">
            // 404
          </p>
          <h1 className="mt-3 text-5xl font-extrabold tracking-tight text-foreground">
            Page not found
          </h1>
          <p className="mt-3 text-muted-foreground">
            The page you&apos;re looking for doesn&apos;t exist in this library.
          </p>
          <Button asChild className="mt-8 rounded-xl">
            <Link to="/">Back to NexET 🇪🇹</Link>
          </Button>
        </div>
      </div>
    </motion.div>
  );
}
