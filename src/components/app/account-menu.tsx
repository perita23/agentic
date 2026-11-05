"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import { LogOutIcon, SettingsIcon, UserRoundIcon } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { api } from "@/lib/api";
import { useDeviceName } from "@/lib/use-device";
import { Avatar, useProfile } from "./avatar";

/** The avatar at the top right: a menu with your account, the settings and signing out. */
export function AccountMenu() {
  const { profile } = useProfile();
  const router = useRouter();
  const device = useDeviceName();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <motion.button type="button" aria-label="Mi cuenta" whileHover={{ scale: 1.06 }} whileTap={{ scale: 0.94 }} className="cursor-pointer rounded-full outline-none focus-visible:ring-2 focus-visible:ring-primary">
          <Avatar profile={profile} size={30} className="ring-1 ring-border" />
        </motion.button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="flex items-center gap-3 py-2">
          <Avatar profile={profile} size={40} />
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-foreground">{profile?.name || "Sin nombre"}</span>
            <span className="block truncate text-xs font-normal text-muted-foreground">{device}</span>
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/account">
            <UserRoundIcon /> Mi cuenta
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/settings">
            <SettingsIcon /> Ajustes
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={async () => {
            try {
              await api("POST", "/api/auth/logout");
            } finally {
              router.push("/login");
              router.refresh();
            }
          }}
        >
          <LogOutIcon /> Cerrar sesión
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
