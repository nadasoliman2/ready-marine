'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from '../../../../lib/navigation';
import { Loader2, ArrowLeft, Send, AlertCircle, CheckCircle, Clock, XCircle, BadgeCheck } from 'lucide-react';
import { ticketApi } from '../../../../lib/api';
import { getSocket, joinTicket, leaveTicket } from '../../../../lib/socket';
import { useApp } from '../../../../context/AppContext';

const STATUS_COLORS = {
    open: 'bg-amber-500/20 text-amber-500',
    pending: 'bg-blue-500/20 text-blue-500',
    resolved: 'bg-emerald-500/20 text-emerald-500',
    closed: 'bg-zinc-500/20 text-zinc-500',
};

const STATUS_ICONS = {
    open: AlertCircle,
    pending: Clock,
    resolved: CheckCircle,
    closed: XCircle,
};

const PRIORITY_COLORS = {
    low: 'bg-zinc-500/20 text-zinc-400',
    medium: 'bg-blue-500/20 text-blue-500',
    high: 'bg-red-500/20 text-red-500',
    urgent: 'bg-red-500/20 text-red-500',
};

const CATEGORY_LABELS_AR = {
    account: 'الحساب',
    order: 'الطلب',
    product: 'المنتج',
    payment: 'الدفع',
    technical: 'تقني',
    other: 'أخرى',
};

export default function VendorTicketDetailPage() {
    const params = useParams();
    const router = useRouter();
    const { language, user } = useApp();
    const isAr = language === 'ar';
    const ticketId = params.id;
    const messagesEndRef = useRef(null);
    const messagesContainerRef = useRef(null);

    const [ticket, setTicket] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [replyContent, setReplyContent] = useState('');
    const [sending, setSending] = useState(false);

    const fetchTicket = async () => {
        try {
            const data = await ticketApi.getTicketById(ticketId);
            setTicket(data.ticket);
        } catch (err) {
            setError(isAr ? 'تعذر تحميل تذكرة الدعم.' : (err.message || 'Failed to load ticket.'));
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchTicket();
    }, [ticketId]);

    const scrollMessagesToBottom = useCallback((behavior = 'smooth') => {
        requestAnimationFrame(() => {
            const container = messagesContainerRef.current;
            if (container) {
                container.scrollTo({ top: container.scrollHeight, behavior });
                return;
            }
            messagesEndRef.current?.scrollIntoView({ behavior });
        });
    }, []);

    useEffect(() => {
        if (ticket) scrollMessagesToBottom('smooth');
    }, [ticket?.messages?.length, scrollMessagesToBottom]);

    // Live updates via WebSocket
    useEffect(() => {
        if (!ticketId) return;
        const socket = getSocket();
        if (!socket) return;

        joinTicket(ticketId);
        const onConnect = () => joinTicket(ticketId);
        const onUpdated = (updated) => {
            if (updated && String(updated._id) === String(ticketId)) {
                setTicket(updated);
            }
        };

        socket.on('connect', onConnect);
        socket.on('ticket:updated', onUpdated);

        return () => {
            socket.off('connect', onConnect);
            socket.off('ticket:updated', onUpdated);
            leaveTicket(ticketId);
        };
    }, [ticketId]);

    const handleReply = async (e) => {
        e.preventDefault();
        if (!replyContent.trim()) return;

        setSending(true);
        try {
            const data = await ticketApi.replyToTicket(ticketId, replyContent);
            setTicket(data.ticket);
            setReplyContent('');
            scrollMessagesToBottom('smooth');
        } catch (err) {
            alert(isAr ? 'تعذر إرسال الرد.' : (err.message || 'Failed to send reply.'));
        } finally {
            setSending(false);
        }
    };

    const formatDate = (dateStr) => {
        if (!dateStr) return '';
        return new Date(dateStr).toLocaleString(isAr ? 'ar-EG' : 'en-US', {
            year: 'numeric', month: 'short', day: 'numeric',
            hour: '2-digit', minute: '2-digit',
        });
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-[60vh]">
                <Loader2 size={36} className="text-marine-primary animate-spin" />
            </div>
        );
    }

    if (error || !ticket) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh] text-zinc-400">
                <AlertCircle size={48} className="mb-3 opacity-40" />
                <p className="text-base font-medium">{error || (isAr ? 'تذكرة الدعم غير موجودة.' : 'Ticket not found')}</p>
                <button
                    onClick={() => router.push('/dashboard/tickets')}
                    className="mt-4 px-4 py-2 bg-marine-cyan/10 text-marine-primary rounded-lg text-sm hover:bg-marine-cyan/20 transition-colors"
                >
                    {isAr ? 'العودة' : 'Go Back'}
                </button>
            </div>
        );
    }

    const StatusIcon = STATUS_ICONS[ticket.status] || AlertCircle;
    const authorColor = ticket.authorRole === 'vendor' ? 'bg-violet-500' : 'bg-cyan-500';
    const authorInitial = (ticket.authorName || '?')[0].toUpperCase();

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center gap-4">
                <button
                    onClick={() => router.push('/dashboard/tickets')}
                    className="p-2 rounded-lg border border-zinc-200 dark:border-zinc-600 hover:bg-zinc-100 dark:hover:bg-[#1a1d24] transition-colors"
                >
                    <ArrowLeft size={18} className="text-zinc-600 dark:text-zinc-400" />
                </button>
                <div className="flex-1">
                    <h1 className="text-xl font-bold text-zinc-900 dark:text-white line-clamp-1">{ticket.title}</h1>
                    <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-0.5 capitalize">
                        {isAr ? (CATEGORY_LABELS_AR[ticket.category] || 'أخرى') : ticket.category}
                    </p>
                </div>
                <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium ${STATUS_COLORS[ticket.status] || ''}`}>
                    <StatusIcon size={14} />
                    {isAr
                        ? { open: 'مفتوح', pending: 'قيد الانتظار', resolved: 'تم الحل', closed: 'مغلق' }[ticket.status]
                        : (ticket.status || 'open').charAt(0).toUpperCase() + (ticket.status || 'open').slice(1)
                    }
                </span>
            </div>

            {/* Thread */}
            <div className="bg-white dark:bg-[#1a1d24] rounded-xl border border-zinc-200 dark:border-zinc-700 overflow-hidden">
                <div ref={messagesContainerRef} className="flex-1 overflow-y-auto px-6 py-4 space-y-4 max-h-[55vh]">
                    {/* Initial description */}
                    <div className="flex gap-3">
                        <div className={`flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-bold ${authorColor}`}>
                            {authorInitial}
                        </div>
                        <div className="flex-1">
                            <div className="flex items-baseline gap-2 mb-1">
                                <span className="text-sm font-semibold text-zinc-900 dark:text-white">{ticket.authorName}</span>
                                <span className="text-xs text-zinc-400">{formatDate(ticket.createdAt)}</span>
                            </div>
                            <div className="bg-zinc-100 dark:bg-[#0E1012] rounded-xl rounded-tl-sm px-4 py-3 text-sm text-zinc-800 dark:text-zinc-200 leading-relaxed">
                                {ticket.description}
                            </div>
                            <div className="mt-1.5 flex items-center gap-2">
                                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${PRIORITY_COLORS[ticket.priority]}`}>
                                    {isAr
                                        ? { low: 'منخفض', medium: 'متوسط', high: 'عالي', urgent: 'عاجل' }[ticket.priority]
                                        : (ticket.priority || 'medium').charAt(0).toUpperCase() + (ticket.priority || 'medium').slice(1)
                                    }
                                </span>
                            </div>
                        </div>
                    </div>

                    {/* Reply messages */}
                    {ticket.messages?.map((msg, idx) => (
                        <div key={idx} className={`flex gap-3 ${msg.senderRole === 'admin' ? 'flex-row-reverse' : ''}`}>
                            <div className={`flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-bold ${
                                msg.senderRole === 'admin' ? 'bg-marine-cyan'
                                    : msg.senderRole === 'vendor' ? 'bg-violet-500' : 'bg-cyan-500'
                            }`}>
                                {msg.senderRole === 'admin' ? <BadgeCheck size={16} /> : (msg.senderName?.[0]?.toUpperCase() || '?')}
                            </div>
                            <div className="flex-1">
                                <div className={`flex items-baseline gap-2 mb-1 ${msg.senderRole === 'admin' ? 'flex-row-reverse' : ''}`}>
                                    <span className="text-sm font-semibold text-zinc-900 dark:text-white">
                                        {msg.senderRole === 'admin' ? (isAr ? 'الدعم الفني' : 'Support') : msg.senderName}
                                    </span>
                                    <span className="text-xs text-zinc-400">{formatDate(msg.createdAt)}</span>
                                </div>
                                <div className={`rounded-xl px-4 py-3 text-sm leading-relaxed ${
                                    msg.senderRole === 'admin'
                                        ? 'bg-marine-cyan/10 text-zinc-900 dark:text-white rounded-tr-sm'
                                        : 'bg-zinc-100 dark:bg-[#0E1012] text-zinc-800 dark:text-zinc-200 rounded-tl-sm'
                                }`}>
                                    {msg.content}
                                </div>
                            </div>
                        </div>
                    ))}
                    <div ref={messagesEndRef} />
                </div>

                {/* Reply Form */}
                {ticket.status !== 'closed' ? (
                    <div className="border-t border-zinc-100 dark:border-zinc-700 p-4">
                        <form onSubmit={handleReply} className="flex gap-3">
                            <textarea
                                value={replyContent}
                                onChange={(e) => setReplyContent(e.target.value)}
                                placeholder={isAr ? 'اكتب رداً...' : 'Write a reply...'}
                                rows={3}
                                className="flex-1 resize-none rounded-xl border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-[#0E1012] text-zinc-900 dark:text-zinc-100 text-sm px-4 py-3 focus:outline-none focus:ring-2 focus:ring-marine-cyan/50"
                            />
                            <button
                                type="submit"
                                disabled={!replyContent.trim() || sending}
                                className="self-end px-5 py-3 bg-marine-cyan hover:bg-[#b55d16] disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl text-sm font-medium transition-colors flex items-center gap-2"
                            >
                                {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                                {isAr ? 'إرسال' : 'Send'}
                            </button>
                        </form>
                    </div>
                ) : (
                    <div className="border-t border-zinc-100 dark:border-zinc-700 p-4 text-center text-sm text-zinc-400">
                        {isAr ? 'هذه التذكرة مغلقة.' : 'This ticket is closed.'}
                    </div>
                )}
            </div>
        </div>
    );
}
