// Tiny toast store. AppShell renders <Toaster />; anything can call toast.success(...)

export type ToastTone = 'success' | 'danger' | 'info' | 'warning';
export interface ToastItem {
	id: number;
	tone: ToastTone;
	title: string;
	body?: string;
}

let nextId = 1;

class ToastStore {
	items = $state<ToastItem[]>([]);

	push(tone: ToastTone, title: string, body?: string, ttl = 5000) {
		const id = nextId++;
		this.items = [...this.items, { id, tone, title, body }].slice(-4);
		if (typeof window !== 'undefined' && ttl > 0) setTimeout(() => this.dismiss(id), ttl);
		return id;
	}
	success(title: string, body?: string) {
		return this.push('success', title, body);
	}
	error(title: string, body?: string) {
		return this.push('danger', title, body, 8000);
	}
	info(title: string, body?: string) {
		return this.push('info', title, body);
	}
	dismiss(id: number) {
		this.items = this.items.filter((t) => t.id !== id);
	}
}

export const toast = new ToastStore();
