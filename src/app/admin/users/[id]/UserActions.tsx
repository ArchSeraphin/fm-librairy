'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Ban, UserCheck, Trash2, Shield, KeyRound, Loader2, RefreshCw } from 'lucide-react';

import { trpc } from '@/lib/trpc/client';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type DialogKind = null | 'suspend' | 'delete' | 'role' | 'reset2fa';

interface Props {
  userId: string;
  userEmail: string;
  currentRole: 'GLOBAL_ADMIN' | 'USER';
  currentStatus: 'ACTIVE' | 'SUSPENDED';
  twoFactorEnabled: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function UserActions({
  userId,
  userEmail,
  currentRole,
  currentStatus,
  twoFactorEnabled,
}: Props) {
  const t = useTranslations('admin.users');
  const td = useTranslations('admin.users.dialogs');
  const router = useRouter();
  const { toast } = useToast();
  const utils = trpc.useUtils();

  // Dialog state
  const [openDialog, setOpenDialog] = React.useState<DialogKind>(null);

  // Suspend form state
  const [suspendReason, setSuspendReason] = React.useState('');

  // Delete form state
  const [confirmEmail, setConfirmEmail] = React.useState('');

  // Role form state
  const [newRole, setNewRole] = React.useState<'GLOBAL_ADMIN' | 'USER'>(currentRole);

  // Reset 2FA form state
  const [resetReason, setResetReason] = React.useState('');

  // Close dialog helper — resets local state
  function closeDialog() {
    setOpenDialog(null);
    setSuspendReason('');
    setConfirmEmail('');
    setNewRole(currentRole);
    setResetReason('');
  }

  // Shared success handler
  function handleSuccess() {
    toast({ title: td('successToast') });
    utils.admin.users.invalidate().catch(() => null);
    router.refresh();
    closeDialog();
  }

  // Shared error handler
  function handleError(err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    toast({ title: td('errorToast'), description: message, variant: 'destructive' });
  }

  // ---------------------------------------------------------------------------
  // Mutations
  // ---------------------------------------------------------------------------

  const suspend = trpc.admin.users.suspend.useMutation({
    onSuccess: handleSuccess,
    onError: handleError,
  });

  const reactivate = trpc.admin.users.reactivate.useMutation({
    onSuccess: handleSuccess,
    onError: handleError,
  });

  const deleteUser = trpc.admin.users.delete.useMutation({
    onSuccess: () => {
      toast({ title: td('successToast') });
      utils.admin.users.invalidate().catch(() => null);
      router.push('/admin/users');
    },
    onError: handleError,
  });

  const changeRole = trpc.admin.users.changeRole.useMutation({
    onSuccess: handleSuccess,
    onError: handleError,
  });

  const resetTwoFactor = trpc.admin.users.resetTwoFactor.useMutation({
    onSuccess: handleSuccess,
    onError: handleError,
  });

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="space-y-4">
      {/* Primary actions row */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Suspend — only when ACTIVE */}
        {currentStatus === 'ACTIVE' && (
          <Button variant="outline" size="sm" onClick={() => setOpenDialog('suspend')}>
            <Ban className="h-4 w-4" aria-hidden="true" />
            {td('suspendCta')}
          </Button>
        )}

        {/* Reactivate — only when SUSPENDED (single button, no dialog) */}
        {currentStatus === 'SUSPENDED' && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => reactivate.mutate({ id: userId })}
            disabled={reactivate.isPending}
          >
            {reactivate.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <UserCheck className="h-4 w-4" aria-hidden="true" />
            )}
            {td('reactivateCta')}
          </Button>
        )}

        {/* Change role */}
        <Button variant="outline" size="sm" onClick={() => setOpenDialog('role')}>
          <Shield className="h-4 w-4" aria-hidden="true" />
          {td('changeRoleCta')}
        </Button>

        {/* Reset 2FA — hidden for GLOBAL_ADMIN (router enforces too) */}
        {currentRole !== 'GLOBAL_ADMIN' && twoFactorEnabled && (
          <Button variant="outline" size="sm" onClick={() => setOpenDialog('reset2fa')}>
            <KeyRound className="h-4 w-4" aria-hidden="true" />
            {td('resetTwoFactorCta')}
          </Button>
        )}
      </div>

      {/* Destructive zone — visually separated */}
      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
        <Button variant="destructive" size="sm" onClick={() => setOpenDialog('delete')}>
          <Trash2 className="h-4 w-4" aria-hidden="true" />
          {td('deleteCta')}
        </Button>
      </div>

      {/* ------------------------------------------------------------------- */}
      {/* Dialog: Suspend                                                       */}
      {/* ------------------------------------------------------------------- */}
      <Dialog open={openDialog === 'suspend'} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{td('suspendTitle')}</DialogTitle>
            <DialogDescription>{td('suspendDescription')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="suspend-reason">{td('reasonLabel')}</Label>
              <Input
                id="suspend-reason"
                placeholder={td('reasonPlaceholder')}
                value={suspendReason}
                onChange={(e) => setSuspendReason(e.target.value)}
                autoFocus
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={closeDialog} disabled={suspend.isPending}>
              {td('cancelCta')}
            </Button>
            <Button
              size="sm"
              onClick={() => suspend.mutate({ id: userId, reason: suspendReason })}
              disabled={suspend.isPending || suspendReason.trim().length < 3}
            >
              {suspend.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              {td('confirmCta')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ------------------------------------------------------------------- */}
      {/* Dialog: Delete                                                        */}
      {/* ------------------------------------------------------------------- */}
      <Dialog open={openDialog === 'delete'} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{td('deleteTitle')}</DialogTitle>
            <DialogDescription>{td('deleteDescription')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="delete-confirm-email">{td('deleteConfirmEmailLabel')}</Label>
              <Input
                id="delete-confirm-email"
                type="email"
                placeholder={userEmail}
                value={confirmEmail}
                onChange={(e) => setConfirmEmail(e.target.value)}
                autoFocus
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={closeDialog}
              disabled={deleteUser.isPending}
            >
              {td('cancelCta')}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => deleteUser.mutate({ id: userId, confirmEmail })}
              disabled={
                deleteUser.isPending || confirmEmail.toLowerCase() !== userEmail.toLowerCase()
              }
            >
              {deleteUser.isPending && (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              )}
              {td('confirmCta')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ------------------------------------------------------------------- */}
      {/* Dialog: Change role                                                   */}
      {/* ------------------------------------------------------------------- */}
      <Dialog open={openDialog === 'role'} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{td('changeRoleTitle')}</DialogTitle>
            <DialogDescription>{td('changeRoleDescription')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="role-select">{t('tableRole')}</Label>
              <select
                id="role-select"
                value={newRole}
                onChange={(e) => setNewRole(e.target.value as 'GLOBAL_ADMIN' | 'USER')}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value="USER">{t('roleUser')}</option>
                <option value="GLOBAL_ADMIN">{t('roleAdmin')}</option>
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={closeDialog}
              disabled={changeRole.isPending}
            >
              {td('cancelCta')}
            </Button>
            <Button
              size="sm"
              onClick={() => changeRole.mutate({ id: userId, newRole })}
              disabled={changeRole.isPending || newRole === currentRole}
            >
              {changeRole.isPending && (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              )}
              {td('confirmCta')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ------------------------------------------------------------------- */}
      {/* Dialog: Reset 2FA                                                     */}
      {/* ------------------------------------------------------------------- */}
      <Dialog open={openDialog === 'reset2fa'} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{td('resetTwoFactorTitle')}</DialogTitle>
            <DialogDescription>{td('resetTwoFactorDescription')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="reset2fa-reason">{td('reasonLabel')}</Label>
              <Input
                id="reset2fa-reason"
                placeholder={td('reasonPlaceholder')}
                value={resetReason}
                onChange={(e) => setResetReason(e.target.value)}
                autoFocus
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={closeDialog}
              disabled={resetTwoFactor.isPending}
            >
              {td('cancelCta')}
            </Button>
            <Button
              size="sm"
              onClick={() => resetTwoFactor.mutate({ id: userId, reason: resetReason })}
              disabled={resetTwoFactor.isPending || resetReason.trim().length < 3}
            >
              {resetTwoFactor.isPending && (
                <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" />
              )}
              {td('confirmCta')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
