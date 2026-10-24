import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Disclosure } from "../components/app/disclosure";
import { Segmented } from "../components/app/segmented";
import { Stepper } from "../components/app/stepper";
import { Timeline } from "../components/app/timeline";
import { Topbar } from "../components/app/topbar";

describe("member pages follow the landing's look (U-75)", () => {
  it("the tab row marks one tab selected and slides a single highlight", () => {
    const html = renderToStaticMarkup(
      <Segmented
        id="t"
        label="Show"
        options={[
          { value: "open", label: "Open" },
          { value: "all", label: "All" },
        ]}
        value="all"
        onChange={() => {}}
      />,
    );
    expect(html).toContain('role="tablist"');
    expect(html.match(/aria-selected="true"/g)).toHaveLength(1);
    expect(html.match(/shadow-soft/g)).toHaveLength(1);
  });

  it("the stepper shows a check for done steps and a dark pill on the current one", () => {
    const html = renderToStaticMarkup(<Stepper steps={["Org", "Amount", "Review"]} current={1} />);
    expect(html).toContain('aria-label="Done"');
    expect(html).toContain('aria-current="step"');
    expect(html).toContain("bg-ink");
  });

  it("a disclosure keeps its content folded until opened", () => {
    expect(renderToStaticMarkup(<Disclosure label="Cash out">form</Disclosure>)).not.toContain("form");
    const open = renderToStaticMarkup(
      <Disclosure label="Cash out" defaultOpen>
        form
      </Disclosure>,
    );
    expect(open).toContain("form");
    expect(open).toContain('aria-expanded="true"');
  });

  it("the timeline's current step is black, not link blue", () => {
    const html = renderToStaticMarkup(
      <Timeline
        steps={[
          { label: "Sent", status: "done" },
          { label: "In review", status: "current" },
          { label: "Paid", status: "upcoming" },
        ]}
      />,
    );
    expect(html).toContain("border-foreground");
    expect(html).not.toContain("border-link");
  });

  it("a page one level down links back to its list", () => {
    const html = renderToStaticMarkup(<Topbar title="You got the loan" crumb="No. 0003" action={null} back={{ href: "/claims/?view=claims", label: "My loans" }} />);
    expect(html).toMatch(/href="\/claims\/?\?view=claims"/);
    expect(html).toContain("My loans");
    expect(renderToStaticMarkup(<Topbar title="Home" action={null} />)).not.toContain("back-link");
  });
});
