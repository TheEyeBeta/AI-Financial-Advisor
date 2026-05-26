import { AlertCircle, X } from "lucide-react";
import { useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";

export const StockDataBanner = () => {
  const [isVisible, setIsVisible] = useState(true);

  if (!isVisible) return null;

  return (
    <div className="border-b bg-yellow-50 dark:bg-yellow-950/20">
      <div className="container mx-auto px-4">
        <Alert className="border-0 bg-transparent p-3">
          <AlertCircle className="h-4 w-4 text-yellow-600 dark:text-yellow-400" />
          <AlertDescription className="ml-2 flex flex-wrap items-center justify-between gap-2 sm:gap-4">
            <span className="text-yellow-800 dark:text-yellow-200">
              Stock data is unavailable until latest June 2
            </span>
            <button
              onClick={() => setIsVisible(false)}
              className="flex-shrink-0 inline-flex p-1 text-yellow-600 hover:bg-yellow-100 dark:text-yellow-400 dark:hover:bg-yellow-950/40 rounded"
            >
              <X className="h-4 w-4" />
            </button>
          </AlertDescription>
        </Alert>
      </div>
    </div>
  );
};
