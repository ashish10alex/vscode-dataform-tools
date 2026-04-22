import { useLayoutEffect, useRef, TextareaHTMLAttributes } from 'react';

type Props = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange'> & {
    value: string;
    onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
};

export function AutoGrowingTextarea({ value, onChange, ...rest }: Props) {
    const ref = useRef<HTMLTextAreaElement>(null);

    useLayoutEffect(() => {
        const el = ref.current;
        if (!el) { return; }
        el.style.height = 'auto';
        el.style.height = `${el.scrollHeight}px`;
    }, [value]);

    useLayoutEffect(() => {
        const el = ref.current;
        if (!el) { return; }
        let prevWidth = el.clientWidth;
        const ro = new ResizeObserver(entries => {
            const width = entries[0].contentRect.width;
            if (width === prevWidth) { return; }
            prevWidth = width;
            el.style.height = 'auto';
            el.style.height = `${el.scrollHeight}px`;
        });
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    return <textarea ref={ref} value={value} onChange={onChange} {...rest} />;
}
