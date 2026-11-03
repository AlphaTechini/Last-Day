<script lang="ts">
	import type { Snippet } from 'svelte';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import type { LucideIcon } from '@lucide/svelte';
	import LayoutGrid from '@lucide/svelte/icons/layout-grid';
	import Users from '@lucide/svelte/icons/users';
	import ListChecks from '@lucide/svelte/icons/list-checks';
	import UserSearch from '@lucide/svelte/icons/user-search';
	import Plug from '@lucide/svelte/icons/plug';
	import ScrollText from '@lucide/svelte/icons/scroll-text';
	import Settings from '@lucide/svelte/icons/settings';
	import LogOut from '@lucide/svelte/icons/log-out';
	import Menu from '@lucide/svelte/icons/menu';
	import X from '@lucide/svelte/icons/x';
	import Sun from '@lucide/svelte/icons/sun';
	import Moon from '@lucide/svelte/icons/moon';
	import Monitor from '@lucide/svelte/icons/monitor';
	import ChevronsUpDown from '@lucide/svelte/icons/chevrons-up-down';
	import FlaskConical from '@lucide/svelte/icons/flask-conical';
	import Logo from '#lib/components/ui/Logo.svelte';
	import Avatar from '#lib/components/ui/Avatar.svelte';
	import Toaster from '#lib/components/ui/Toaster.svelte';
	import type { AppLayoutData } from '#lib/ui/page-data.ts';
	import { applyTheme, readTheme, type ThemePref } from '#lib/ui/theme.ts';

	let {
		user,
		nav,
		isDemo,
		currentPath,
		children
	}: AppLayoutData & { currentPath?: string; children: Snippet } = $props();

	type NavItem = { href: string; label: string; icon: LucideIcon; count?: number; tone?: 'danger' | 'warning' | 'neutral'; countLabel?: string };

	const items: NavItem[] = $derived([
		{
			href: '/',
			label: 'Dashboard',
			icon: LayoutGrid,
			count: nav.needsAttentionCount,
			tone: 'danger',
			countLabel: 'need attention'
		},
		{ href: '/employees', label: 'Employees', icon: Users },
		{
			href: '/runs',
			label: 'Runs',
			icon: ListChecks,
			count: nav.pendingDestroyCount,
			tone: 'warning',
			countLabel: 'waiting on a manager'
		},
		{ href: '/unknown', label: 'Unknown owners', icon: UserSearch, count: nav.unknownCount, tone: 'neutral', countLabel: 'unlinked accounts' },
		{ href: '/connections', label: 'Connections', icon: Plug },
		{ href: '/audit', label: 'Audit log', icon: ScrollText },
		{ href: '/settings', label: 'Settings', icon: Settings }
	]);

	const path = $derived(currentPath ?? page.url.pathname);
	const isActive = (href: string) => (href === '/' ? path === '/' : path === href || path.startsWith(href + '/'));

	const ROLE_LABEL = { admin: 'Admin', hr: 'People ops', manager: 'Manager', judge: 'Judge (demo)' } as const;

	let drawerOpen = $state(false);
	let menuOpen = $state(false);
	let theme = $state<ThemePref>('system');
	let menuEl: HTMLDivElement | undefined = $state();

	onMount(() => {
		theme = readTheme();
	});

	$effect(() => {
		void path;
		drawerOpen = false;
		menuOpen = false;
	});

	function setTheme(t: ThemePref) {
		theme = t;
		applyTheme(t);
	}

	function onWindowClick(e: MouseEvent) {
		if (menuOpen && menuEl && !menuEl.contains(e.target as Node)) menuOpen = false;
	}
	function onKey(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			menuOpen = false;
			drawerOpen = false;
		}
	}
</script>

<svelte:window onclick={onWindowClick} onkeydown={onKey} />

<a class="skip" href="#main">Skip to content</a>

<div class="shell" class:drawer-open={drawerOpen}>
	<header class="topbar">
		<button class="icon-btn" type="button" aria-label="Open navigation" aria-expanded={drawerOpen} aria-controls="sidebar" onclick={() => (drawerOpen = true)}>
			<Menu size={18} strokeWidth={1.9} />
		</button>
		<a href="/" class="topbar-logo"><Logo size={22} /></a>
		<span class="topbar-spacer"></span>
		<Avatar name={user.name} size={26} />
	</header>

	<button class="scrim" type="button" tabindex="-1" aria-label="Close navigation" onclick={() => (drawerOpen = false)}></button>

	<aside class="sidebar" id="sidebar" aria-label="Main">
		<div class="brand">
			<a href="/" class="brand-link" aria-label="Last Day home">
				<span class="logo-full"><Logo size={24} /></span>
				<span class="logo-mark"><Logo size={26} wordmark={false} /></span>
			</a>
			<button class="icon-btn drawer-close" type="button" aria-label="Close navigation" onclick={() => (drawerOpen = false)}>
				<X size={18} strokeWidth={1.9} />
			</button>
		</div>

		{#if isDemo}
			<div class="workspace" title="Northwind Labs is a fictional demo company">
				<span class="ws-mark" aria-hidden="true">N</span>
				<span class="ws-text">
					<span class="ws-name">Northwind Labs</span>
					<span class="ws-sub">Demo company</span>
				</span>
			</div>
		{/if}

		<nav class="nav">
			<ul role="list">
				{#each items as item (item.href)}
					{@const active = isActive(item.href)}
					<li>
						<a href={item.href} class="nav-item" class:active aria-current={active ? 'page' : undefined} title={item.label}>
							<item.icon size={16} strokeWidth={active ? 2.1 : 1.85} aria-hidden="true" />
							<span class="nav-label">{item.label}</span>
							{#if item.count}
								<span class="count tone-{item.tone}" aria-label="{item.count} {item.countLabel}">{item.count}</span>
							{/if}
						</a>
					</li>
				{/each}
			</ul>
		</nav>

		<div class="user" bind:this={menuEl}>
			{#if menuOpen}
				<div class="menu" role="menu" aria-label="Account">
					<div class="menu-head">
						<p class="menu-name">{user.name}</p>
						<p class="menu-email">{user.email}</p>
					</div>
					<div class="menu-section">
						<p class="menu-label">Theme</p>
						<div class="theme-row" role="radiogroup" aria-label="Theme">
							{#each [['system', 'System', Monitor], ['light', 'Light', Sun], ['dark', 'Dark', Moon]] as const as [value, label, Icon] (value)}
								<button type="button" role="radio" aria-checked={theme === value} class:on={theme === value} onclick={() => setTheme(value)}>
									<Icon size={14} strokeWidth={1.9} aria-hidden="true" />
									{label}
								</button>
							{/each}
						</div>
					</div>
					<form method="POST" action="/logout" class="menu-section">
						<button type="submit" role="menuitem" class="menu-item">
							<LogOut size={15} strokeWidth={1.9} aria-hidden="true" />
							Sign out
						</button>
					</form>
				</div>
			{/if}
			<button class="user-btn" type="button" aria-haspopup="menu" aria-expanded={menuOpen} onclick={() => (menuOpen = !menuOpen)}>
				<Avatar name={user.name} size={28} />
				<span class="user-text">
					<span class="user-name">{user.name}</span>
					<span class="user-role">{ROLE_LABEL[user.role]}</span>
				</span>
				<ChevronsUpDown size={14} strokeWidth={1.9} aria-hidden="true" class="user-chev" />
			</button>
		</div>
	</aside>

	<div class="main-col">
		{#if isDemo}
			<div class="demo-banner" role="note">
				<FlaskConical size={14} strokeWidth={2} aria-hidden="true" />
				<span>
					<strong>Demo company.</strong> Northwind Labs and its people are fictional. Every API call goes to real systems.
				</span>
			</div>
		{/if}
		<main id="main" class="main" tabindex="-1">
			{@render children()}
		</main>
	</div>
</div>

<Toaster />

<style>
	.skip {
		position: absolute;
		left: 12px;
		top: -48px;
		z-index: 100;
		padding: 8px 12px;
		border-radius: var(--radius-sm);
		background: var(--primary);
		color: var(--primary-text);
		font-weight: var(--weight-medium);
	}
	.skip:focus {
		top: 12px;
	}

	.shell {
		min-height: 100dvh;
	}

	/* ---------- Sidebar ---------- */
	.sidebar {
		position: fixed;
		inset: 0 auto 0 0;
		z-index: var(--z-nav);
		width: var(--sidebar-w);
		display: flex;
		flex-direction: column;
		padding: 14px 10px 10px;
		background: var(--bg-sidebar);
		border-right: 1px solid var(--border);
	}
	.brand {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 2px 8px 14px;
	}
	.brand-link {
		color: var(--text);
		border-radius: var(--radius-sm);
	}
	.brand-link:hover {
		text-decoration: none;
	}
	.logo-mark {
		display: none;
	}
	.drawer-close {
		display: none;
	}

	.workspace {
		display: flex;
		align-items: center;
		gap: 9px;
		margin: 0 0 12px;
		padding: 7px 8px;
		border-radius: var(--radius-md);
		background: var(--surface);
		box-shadow:
			0 0 0 1px var(--border),
			var(--shadow-xs);
	}
	.ws-mark {
		display: grid;
		place-items: center;
		width: 24px;
		height: 24px;
		flex: none;
		border-radius: 6px;
		background: var(--accent-soft);
		color: var(--accent-text);
		font-weight: 650;
		font-size: 12px;
		box-shadow: inset 0 0 0 1px var(--accent-border);
	}
	.ws-text {
		display: flex;
		flex-direction: column;
		min-width: 0;
		line-height: 1.2;
	}
	.ws-name {
		font-size: var(--text-sm);
		font-weight: var(--weight-semibold);
	}
	.ws-sub {
		font-size: var(--text-xs);
		color: var(--text-3);
	}

	.nav {
		flex: 1;
		overflow-y: auto;
	}
	.nav ul {
		display: flex;
		flex-direction: column;
		gap: 1px;
	}
	.nav-item {
		display: flex;
		align-items: center;
		gap: 10px;
		height: 32px;
		padding: 0 9px;
		border-radius: var(--radius-sm);
		color: var(--text-2);
		font-size: var(--text-base);
		font-weight: var(--weight-medium);
		text-decoration: none;
		transition:
			background-color var(--dur-1) var(--ease-out),
			color var(--dur-1) var(--ease-out);
	}
	.nav-item:hover {
		background: var(--surface-3);
		color: var(--text);
		text-decoration: none;
	}
	.nav-item.active {
		background: var(--surface);
		color: var(--text);
		box-shadow:
			0 0 0 1px var(--border),
			0 1px 2px rgb(16 24 40 / 0.05);
	}
	.nav-label {
		flex: 1;
		min-width: 0;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.count {
		min-width: 18px;
		height: 18px;
		padding: 0 5px;
		border-radius: var(--radius-full);
		display: inline-grid;
		place-items: center;
		font-size: 11px;
		font-weight: var(--weight-semibold);
		font-variant-numeric: tabular-nums;
		background: var(--surface-3);
		color: var(--text-2);
		box-shadow: inset 0 0 0 1px var(--border);
	}
	.count.tone-danger {
		background: var(--danger);
		color: #fff;
		box-shadow: none;
	}
	.count.tone-warning {
		background: var(--warning-soft-2);
		color: var(--warning-text);
		box-shadow: inset 0 0 0 1px var(--warning-border);
	}

	/* ---------- User menu ---------- */
	.user {
		position: relative;
		padding-top: 8px;
		border-top: 1px solid var(--border-subtle);
	}
	.user-btn {
		display: flex;
		align-items: center;
		gap: 9px;
		width: 100%;
		padding: 6px;
		border-radius: var(--radius-md);
		text-align: left;
	}
	.user-btn:hover {
		background: var(--surface-3);
	}
	.user-text {
		display: flex;
		flex-direction: column;
		flex: 1;
		min-width: 0;
		line-height: 1.25;
	}
	.user-name {
		font-size: var(--text-sm);
		font-weight: var(--weight-medium);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.user-role {
		font-size: var(--text-xs);
		color: var(--text-3);
	}
	.user-btn :global(.user-chev) {
		color: var(--text-3);
		flex: none;
	}
	.menu {
		position: absolute;
		left: 0;
		right: 0;
		bottom: calc(100% + 6px);
		z-index: var(--z-overlay);
		padding: 4px;
		border-radius: var(--radius-lg);
		background: var(--surface-raised);
		border: 1px solid var(--border);
		box-shadow: var(--shadow-lg);
		animation: menu-in var(--dur-2) var(--ease-out);
		min-width: 216px;
	}
	@keyframes menu-in {
		from {
			opacity: 0;
			transform: translateY(4px);
		}
	}
	.menu-head {
		padding: 8px 10px 10px;
		border-bottom: 1px solid var(--border-subtle);
	}
	.menu-name {
		font-weight: var(--weight-semibold);
		font-size: var(--text-sm);
	}
	.menu-email {
		font-size: var(--text-xs);
		color: var(--text-3);
		overflow-wrap: anywhere;
	}
	.menu-section {
		padding: 6px 6px;
	}
	.menu-section + .menu-section {
		border-top: 1px solid var(--border-subtle);
	}
	.menu-label {
		font-size: var(--text-xs);
		color: var(--text-3);
		padding: 2px 4px 6px;
	}
	.theme-row {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 2px;
		padding: 2px;
		border-radius: var(--radius-sm);
		background: var(--surface-3);
	}
	.theme-row button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 5px;
		height: 26px;
		border-radius: 5px;
		font-size: var(--text-xs);
		font-weight: var(--weight-medium);
		color: var(--text-2);
	}
	.theme-row button.on {
		background: var(--surface);
		color: var(--text);
		box-shadow: 0 0 0 1px var(--border);
	}
	.menu-item {
		display: flex;
		align-items: center;
		gap: 9px;
		width: 100%;
		height: 30px;
		padding: 0 6px;
		border-radius: var(--radius-sm);
		font-size: var(--text-sm);
		color: var(--text);
	}
	.menu-item:hover {
		background: var(--surface-3);
	}

	/* ---------- Main ---------- */
	.main-col {
		margin-left: var(--sidebar-w);
		min-width: 0;
		display: flex;
		flex-direction: column;
		min-height: 100dvh;
	}
	.demo-banner {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		padding: 7px 16px;
		font-size: var(--text-xs);
		color: var(--text-2);
		background: var(--surface-2);
		border-bottom: 1px solid var(--border-subtle);
		text-align: center;
	}
	.demo-banner :global(svg) {
		flex: none;
		color: var(--text-3);
	}
	.demo-banner strong {
		color: var(--text);
		font-weight: var(--weight-semibold);
	}
	.main {
		flex: 1;
		width: 100%;
		max-width: calc(var(--content-max) + 2 * var(--gutter));
		margin: 0 auto;
		padding: var(--space-8) var(--gutter) var(--space-16);
	}
	.main:focus {
		box-shadow: none;
	}

	/* ---------- Topbar + drawer (phones) ---------- */
	.topbar,
	.scrim {
		display: none;
	}
	.icon-btn {
		display: grid;
		place-items: center;
		width: 34px;
		height: 34px;
		border-radius: var(--radius-sm);
		color: var(--text-2);
	}
	.icon-btn:hover {
		background: var(--surface-3);
		color: var(--text);
	}

	/* Tablet: icon rail */
	@media (max-width: 1099px) and (min-width: 768px) {
		.sidebar {
			width: var(--rail-w);
			padding: 14px 8px 10px;
			align-items: center;
		}
		.brand {
			padding: 2px 0 14px;
		}
		.logo-full,
		.workspace,
		.nav-label,
		.user-text,
		.user-btn :global(.user-chev) {
			display: none;
		}
		.logo-mark {
			display: block;
		}
		.nav-item {
			position: relative;
			width: 40px;
			height: 36px;
			justify-content: center;
			padding: 0;
		}
		.count {
			position: absolute;
			top: 2px;
			right: 1px;
			min-width: 15px;
			height: 15px;
			padding: 0 3px;
			font-size: 9.5px;
		}
		.user {
			width: 100%;
			display: flex;
			justify-content: center;
		}
		.user-btn {
			width: auto;
			padding: 4px;
		}
		.menu {
			left: 0;
			right: auto;
		}
		.main-col {
			margin-left: var(--rail-w);
		}
		.main {
			--gutter: var(--space-6);
		}
	}

	/* Phone: top bar + off-canvas drawer */
	@media (max-width: 767px) {
		.topbar {
			position: sticky;
			top: 0;
			z-index: var(--z-sticky);
			display: flex;
			align-items: center;
			gap: 8px;
			height: var(--topbar-h);
			padding: 0 12px 0 8px;
			background: color-mix(in srgb, var(--bg) 88%, transparent);
			backdrop-filter: saturate(1.4) blur(10px);
			border-bottom: 1px solid var(--border);
		}
		.topbar-logo {
			color: var(--text);
		}
		.topbar-spacer {
			flex: 1;
		}
		.sidebar {
			width: min(288px, 86vw);
			transform: translateX(-100%);
			transition: transform var(--dur-3) var(--ease-out);
			box-shadow: none;
		}
		.drawer-open .sidebar {
			transform: none;
			box-shadow: var(--shadow-xl);
		}
		.drawer-close {
			display: grid;
		}
		.scrim {
			display: block;
			position: fixed;
			inset: 0;
			z-index: calc(var(--z-nav) - 1);
			background: var(--overlay);
			opacity: 0;
			pointer-events: none;
			transition: opacity var(--dur-3) var(--ease-out);
		}
		.drawer-open .scrim {
			opacity: 1;
			pointer-events: auto;
		}
		.main-col {
			margin-left: 0;
		}
		.main {
			--gutter: var(--space-4);
			padding-top: var(--space-5);
		}
		.nav-item {
			height: 38px;
		}
	}
</style>
