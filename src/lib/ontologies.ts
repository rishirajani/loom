import type { Ontology } from './types'

// A deliberately small, curated subset of schema.org — enough to make
// mapping a typical "people" or "organizations" spreadsheet feel immediate.
// Full schema.org has thousands of properties; shipping all of them would
// make the mapping suggestion UI worse, not better.
export const schemaOrgOntology: Ontology = {
  id: 'schema-org',
  name: 'Schema.org (core subset)',
  prefix: 'schema',
  namespace: 'https://schema.org/',
  classes: [
    { id: 'schema:Person', label: 'Person', comment: 'An individual person.' },
    { id: 'schema:Organization', label: 'Organization', comment: 'An organization such as a company or institution.' },
    { id: 'schema:Place', label: 'Place', comment: 'A physical location.' },
    { id: 'schema:Event', label: 'Event', comment: 'A happening at a certain time and place.' },
  ],
  properties: [
    { id: 'schema:name', label: 'name', comment: 'The name of the item.', domain: ['schema:Person', 'schema:Organization', 'schema:Place', 'schema:Event'], range: 'xsd:string' },
    { id: 'schema:givenName', label: 'given name', comment: 'First name of a person.', aliases: ['first name', 'forename'], domain: ['schema:Person'], range: 'xsd:string' },
    { id: 'schema:familyName', label: 'family name', comment: 'Last name of a person.', aliases: ['last name', 'surname'], domain: ['schema:Person'], range: 'xsd:string' },
    { id: 'schema:email', label: 'email', comment: 'Email address.', aliases: ['mail', 'e-mail'], domain: ['schema:Person', 'schema:Organization'], range: 'xsd:string' },
    { id: 'schema:telephone', label: 'telephone', comment: 'Phone number.', aliases: ['phone', 'mobile', 'cell'], domain: ['schema:Person', 'schema:Organization'], range: 'xsd:string' },
    { id: 'schema:birthDate', label: 'birth date', comment: 'Date of birth.', aliases: ['dob', 'born'], domain: ['schema:Person'], range: 'xsd:date' },
    { id: 'schema:jobTitle', label: 'job title', comment: "The person's job title.", domain: ['schema:Person'], range: 'xsd:string' },
    { id: 'schema:worksFor', label: 'works for', comment: 'Organization the person is affiliated with.', aliases: ['employer', 'company', 'organization', 'org'], domain: ['schema:Person'], isObjectProperty: true },
    { id: 'schema:colleague', label: 'colleague', comment: 'A colleague of the person.', aliases: ['manager', 'supervisor', 'boss', 'reports to', 'coworker'], domain: ['schema:Person'], isObjectProperty: true },
    { id: 'schema:address', label: 'address', comment: 'Physical address.', domain: ['schema:Person', 'schema:Organization', 'schema:Place'], range: 'xsd:string' },
    { id: 'schema:url', label: 'URL', comment: 'A canonical URL for the item.', aliases: ['website', 'homepage', 'link'], domain: ['schema:Person', 'schema:Organization', 'schema:Place', 'schema:Event'], range: 'xsd:anyURI' },
    { id: 'schema:foundingDate', label: 'founding date', comment: 'Date an organization was founded.', domain: ['schema:Organization'], range: 'xsd:date' },
    { id: 'schema:startDate', label: 'start date', comment: 'Start date of an event.', domain: ['schema:Event'], range: 'xsd:date' },
    { id: 'schema:endDate', label: 'end date', comment: 'End date of an event.', domain: ['schema:Event'], range: 'xsd:date' },
    { id: 'schema:latitude', label: 'latitude', domain: ['schema:Place'], range: 'xsd:decimal' },
    { id: 'schema:longitude', label: 'longitude', domain: ['schema:Place'], range: 'xsd:decimal' },
  ],
}

// DCAT — the W3C standard for describing datasets/resources so they can be
// discovered and federated. Direct fit for "open resource discovery" catalogs.
export const dcatOntology: Ontology = {
  id: 'dcat',
  name: 'DCAT (Data Catalog Vocabulary)',
  prefix: 'dcat',
  namespace: 'http://www.w3.org/ns/dcat#',
  classes: [
    { id: 'dcat:Dataset', label: 'Dataset', comment: 'A collection of data, published or curated by a single source.' },
    { id: 'dcat:Distribution', label: 'Distribution', comment: 'A specific representation of a dataset, e.g. a downloadable file.' },
    { id: 'dcat:Catalog', label: 'Catalog', comment: 'A curated collection of metadata about resources.' },
    { id: 'dcat:Resource', label: 'Resource', comment: 'A resource published or curated by a single agent.' },
  ],
  properties: [
    { id: 'dct:title', label: 'title', domain: ['dcat:Dataset', 'dcat:Resource'], range: 'xsd:string' },
    { id: 'dct:description', label: 'description', domain: ['dcat:Dataset', 'dcat:Resource'], range: 'xsd:string' },
    { id: 'dct:license', label: 'license', aliases: ['licence', 'rights'], domain: ['dcat:Dataset', 'dcat:Resource'], range: 'xsd:anyURI' },
    { id: 'dct:publisher', label: 'publisher', domain: ['dcat:Dataset'], isObjectProperty: true },
    { id: 'dct:format', label: 'format', domain: ['dcat:Distribution'], range: 'xsd:string' },
    { id: 'dcat:accessURL', label: 'access URL', domain: ['dcat:Distribution'], range: 'xsd:anyURI' },
    { id: 'dcat:downloadURL', label: 'download URL', domain: ['dcat:Distribution'], range: 'xsd:anyURI' },
    { id: 'dcat:keyword', label: 'keyword', aliases: ['tag', 'tags', 'topics'], domain: ['dcat:Dataset'], range: 'xsd:string' },
    { id: 'dcat:theme', label: 'theme', domain: ['dcat:Dataset'], range: 'xsd:string' },
    { id: 'dct:issued', label: 'issued date', domain: ['dcat:Dataset'], range: 'xsd:date' },
    { id: 'dct:modified', label: 'modified date', domain: ['dcat:Dataset'], range: 'xsd:date' },
  ],
}

export const bundledOntologies: Ontology[] = [schemaOrgOntology, dcatOntology]
