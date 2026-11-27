(function (root) {
  const characters = {"&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"};
  const escape = value => String(value ?? "").replace(/[&<>"']/g, character => characters[character]);
  const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
  const stateText = {
    active: "بطاقة سارية",
    expired: "بطاقة منتهية الصلاحية",
    disabled: "بطاقة غير سارية"
  };

  function expiryLabel(date) {
    const [year, month, day] = String(date).split("-");
    return day + "/" + month + "/" + year;
  }

  // member: public view only — {slug, fullName, role?, photo?, photoVersion?, expiresAt, active, expiryPublic?, memberNumber?, rev?}
  function renderMember(template, member, base, demo = false) {
    if (!slugPattern.test(member.slug) || member.slug.length > 64) throw new Error("Invalid slug");
    const url = new URL(base);
    if (!/^https?:$/.test(url.protocol) || !url.pathname.endsWith("/") || url.search || url.hash) {
      throw new Error("Invalid site URL");
    }
    const title = member.fullName + " | كافل اليتيم – سيدي بلعباس";
    const association = "الجمعية الخيرية كافل اليتيم الوطنية · المكتب الولائي سيدي بلعباس";
    const description = member.role ? member.role + " · " + association : association;
    const photo = member.photo || "assets/logo.jpg";
    if (!/^assets\/(?:logo\.jpg|members\/[a-z0-9-]+\.(?:jpg|jpeg|png|webp))$/.test(photo)) {
      throw new Error("Invalid photo path");
    }
    const state = member.state || (member.active === false ? "disabled" : "active");
    const parameters = {
      ...member, title, description, photo, demo,
      photoQuery: member.photo && member.photoVersion ? "?v=" + member.photoVersion : "",
      photoAlt: member.photo ? member.fullName : "شعار كافل اليتيم",
      photoClass: member.photo ? "" : "logo",
      canonical: new URL("members/" + member.slug + "/", base).href,
      ogImage: new URL(photo, base).href,
      robots: demo ? "noindex, nofollow" : "index, follow",
      active: member.active === false ? "false" : "true",
      expiresAt: member.expiresAt || "",
      expiryText: member.expiryPublic && member.expiresAt ? expiryLabel(member.expiresAt) : "",
      memberNumber: member.memberNumber || "",
      rev: member.rev || "",
      state, stateText: stateText[state]
    };
    const conditional = template.replace(/{{\?(\w+)}}([\s\S]*?){{\/\1}}/g, (_, key, body) => parameters[key] ? body : "");
    return conditional.replace(/{{(\w+)}}/g, (_, key) => escape(parameters[key]));
  }

  if (typeof module === "object") module.exports = {renderMember, slugPattern, stateText};
  else root.MemberPages = {renderMember, slugPattern, stateText};
})(typeof window === "object" ? window : null);
