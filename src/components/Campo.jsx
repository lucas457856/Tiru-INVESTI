const INPUT_CLASSE =
  "w-full h-12 pl-11 pr-4 rounded-xl border border-slate-200 bg-white text-sm text-slate-800 placeholder-slate-400 outline-none transition focus:border-jurex focus:ring-2 focus:ring-jurex/20";

export { INPUT_CLASSE };

export default function Campo({ label, id, erro = false, children }) {
  const [icone, input] = children;

  return (
    <div>
      <label
        htmlFor={id}
        className="block text-sm font-semibold text-slate-700 mb-2"
      >
        {label}
      </label>
      <div className="relative">
        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none [&>svg]:w-4.5 [&>svg]:h-4.5">
          {icone}
        </span>
        {input && (
          <input
            {...input.props}
            id={id}
            className={`${INPUT_CLASSE} ${
              erro ? "border-red-300 focus:border-red-400 focus:ring-red-100" : ""
            }`}
          />
        )}
      </div>
      {erro === false || typeof erro === "boolean" ? null : erro}
    </div>
  );
}
