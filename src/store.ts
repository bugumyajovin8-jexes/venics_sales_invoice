import { create } from 'zustand';
import { Product, User } from './db';

interface CartItem extends Product {
  qty: number;
}

interface ModalConfig {
  isOpen: boolean;
  type: 'alert' | 'confirm';
  title: string;
  message: string;
  onConfirm?: () => void;
  onCancel?: () => void;
}

interface PosState {
  cart: CartItem[];
  addToCart: (product: Product) => void;
  removeFromCart: (productId: string) => void;
  updateQty: (productId: string, qty: number) => void;
  updateCartItemPrice: (productId: string, price: number) => void;
  clearCart: () => void;
  cartTotal: () => number;
  cartProfit: () => number;
  
  // Auth
  isAuthenticated: boolean;
  token: string | null;
  user: User | null;
  authError: string | null;
  features: Record<string, boolean>;
  setAuth: (token: string | null, user: User | null) => void;
  updateUser: (userUpdates: Partial<User>) => void;
  logout: (error?: string) => void;
  setAuthError: (error: string | null) => void;
  setFeatures: (features: Record<string, boolean>) => void;
  isFeatureEnabled: (key: string) => boolean;
  isBoss: () => boolean;
  
  // Modal
  modal: ModalConfig;
  showAlert: (title: string, message: string) => void;
  showConfirm: (title: string, message: string, onConfirm: () => void, onCancel?: () => void) => void;
  hideModal: () => void;

  // Toast
  toasts: { id: string; message: string; type: 'success' | 'error' | 'info' }[];
  showToast: (message: string, type?: 'success' | 'error' | 'info') => void;
  removeToast: (id: string) => void;

  // Inactivity State Tracker
  isAppInactive: boolean;
  setIsAppInactive: (inactive: boolean) => void;
}

export const useStore = create<PosState>((set, get) => ({
  isAppInactive: false,
  setIsAppInactive: (inactive) => set({ isAppInactive: inactive }),
  cart: [],
  addToCart: (product) => set((state) => {
    const existing = state.cart.find(item => item.id === product.id);
    if (existing) {
      if (existing.qty >= product.stock) {
        return state;
      }
      return {
        cart: state.cart.map(item => 
          item.id === product.id ? { ...item, qty: item.qty + 1 } : item
        )
      };
    }
    if (product.stock <= 0) return state;
    return { cart: [...state.cart, { ...product, qty: 1 }] };
  }),
  removeFromCart: (productId) => set((state) => ({
    cart: state.cart.filter(item => item.id !== productId)
  })),
  updateQty: (productId, qty) => set((state) => {
    const item = state.cart.find(i => i.id === productId);
    if (item && qty > item.stock) {
      return state;
    }
    return {
      cart: state.cart.map(item => 
        item.id === productId ? { ...item, qty } : item
      )
    };
  }),
  updateCartItemPrice: (productId, price) => set((state) => ({
    cart: state.cart.map(item => 
      item.id === productId ? { ...item, sell_price: price } : item
    )
  })),
  clearCart: () => set({ cart: [] }),
  cartTotal: () => get().cart.reduce((total, item) => total + (item.sell_price * item.qty), 0),
  cartProfit: () => get().cart.reduce((total, item) => total + ((item.sell_price - item.buy_price) * item.qty), 0),
  
  isAuthenticated: false,
  token: localStorage.getItem('pos_token') || null,
  user: JSON.parse(localStorage.getItem('pos_user') || 'null'),
  authError: null,
  features: {},
  setAuth: (token, user) => {
    if (token && user) {
      localStorage.setItem('pos_token', token);
      localStorage.setItem('pos_user', JSON.stringify(user));
      set({ isAuthenticated: true, token, user, authError: null });
    } else {
      localStorage.removeItem('pos_token');
      localStorage.removeItem('pos_user');
      set({ isAuthenticated: false, token: null, user: null });
    }
  },
  updateUser: (userUpdates) => set((state) => {
    if (!state.user) return state;
    const updatedUser = { ...state.user, ...userUpdates };
    localStorage.setItem('pos_user', JSON.stringify(updatedUser));
    return { user: updatedUser };
  }),
  logout: (error) => {
    localStorage.removeItem('pos_token');
    localStorage.removeItem('pos_user');
    sessionStorage.removeItem('app_opened_logged');    
    set({ isAuthenticated: false, token: null, user: null, cart: [], authError: error || null });
  },
  setAuthError: (error) => set({ authError: error }),
  setFeatures: (features) => set({ features }),
  isFeatureEnabled: (key) => {
    const value = get().features[key];
    return value === true;
  },
  isBoss: () => {
    const user = get().user;
    return user?.role === 'admin' || user?.role === 'superadmin' || user?.role === 'boss';
  },
  
  modal: {
    isOpen: false,
    type: 'alert',
    title: '',
    message: ''
  },
  showAlert: (title, message) => set({
    modal: { isOpen: true, type: 'alert', title, message }
  }),
  showConfirm: (title, message, onConfirm, onCancel) => set({
    modal: { isOpen: true, type: 'confirm', title, message, onConfirm, onCancel }
  }),
  hideModal: () => set((state) => ({
    modal: { ...state.modal, isOpen: false }
  })),

  toasts: [],
  showToast: (message, type = 'success') => {
    const id = Math.random().toString(36).substring(2, 9);
    set((state) => ({
      toasts: [...state.toasts, { id, message, type }]
    }));
    setTimeout(() => {
      get().removeToast(id);
    }, 3000);
  },
  removeToast: (id) => set((state) => ({
    toasts: state.toasts.filter((t) => t.id !== id)
  }))
}));

// Initialize auth state if token exists
const initialToken = localStorage.getItem('pos_token');
if (initialToken) {
  useStore.setState({ isAuthenticated: true });
}
