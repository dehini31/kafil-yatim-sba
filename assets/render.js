(function (root) {
  const characters = {"&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"};
  const escape = value => String(value).replace(/[&<>"']/g, character => characters[character]);
  const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

  function renderMember(template, member, base, demo = false) {
    if (!slugPattern.test(member.slug) || member.slug.length > 64) throw new Error("Invalid slug");
    const url = new URL(base);
    if (url.protocol !== "https:" || !url.pathname.endsWith("/") || url.search || url.hash) {
      throw new Error("Invalid site URL");
    }
    const title = member.fullName + " | كافل اليتيم – سيدي بلعباس";
    const description = member.role + " · الجمعية الخيرية كافل اليتيم الوطنية · المكتب الولائي سيدي بلعباس";
    const photo = member.photo || "assets/logo.jpg";
    if (!/^assets\/(?:logo\.jpg|members\/[a-z0-9-]+\.(?:jpg|jpeg|png|webp))$/.test(photo)) {
      throw new Error("Invalid photo path");
    }
    const parameters = {
      ...member, title, description, photo, demo,
      photoAlt: member.photo ? member.fullName : "شعار كافل اليتيم",
      photoClass: member.photo ? "" : "logo",
      canonical: new URL("members/" + member.slug + "/", base).href,
      ogImage: new URL(photo, base).href,
      robots: demo ? "noindex, nofollow" : "index, follow"
    };
    return template.replace(/{{(\w+)}}/g, (_, key) => escape(parameters[key]));
  }

  if (typeof module === "object") module.exports = {renderMember, slugPattern};
  else root.MemberPages = {renderMember, slugPattern};
})(typeof window === "object" ? window : null);
