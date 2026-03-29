const PageLoader = ({ message = "Loading..." }: { message?: string }) => (
  <div className="flex flex-1 items-center justify-center py-20">
    <div className="flex flex-col items-center gap-3">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  </div>
);

export default PageLoader;
