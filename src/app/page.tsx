import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { BookOpen } from 'lucide-react';

export default function Home() {
  return (
    <main className="container mx-auto flex min-h-screen items-center justify-center p-8">
      <Card className="w-full max-w-md animate-slide-up">
        <CardHeader className="flex flex-row items-center gap-3">
          <BookOpen className="h-6 w-6 text-accent" aria-hidden />
          <CardTitle>BiblioShare</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Plateforme privée de gestion de bibliothèques.
          </p>
          <Button className="w-full">Bientôt disponible</Button>
        </CardContent>
      </Card>
    </main>
  );
}
