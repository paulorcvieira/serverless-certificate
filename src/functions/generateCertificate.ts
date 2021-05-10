import chromium from "chrome-aws-lambda";
import path from "path";
import handlebars from "handlebars";
import fs from "fs"
import { S3 } from "aws-sdk";

import { document } from "../utils/dynamodbClient";

interface ICreateCertificate {
  id: string;
  name: string;
  grade: string;
}

interface ITemplate {
  id: string;
  name: string;
  grade: string;
  date: string;
  medal: string;
}

const compile = async function(data: ITemplate) {
  const filePath = path
    .join(process.cwd(), "src", "templates", "certificate.hbs");

  const html = fs.readFileSync(filePath, "utf-8");

  return handlebars.compile(html)(data);
}

export const handle = async (event) => {
  const { id, name, grade } = JSON.parse(event.body) as ICreateCertificate;

  console.log("Inserir no DynamoDB os dados do Aluno");
  await document.put({
    TableName: "users_certificates",
    Item: {
      id,
      name,
      grade
    }
  }).promise();

  console.log("Gerar certificado");
  const date = new Date().toLocaleDateString(
    'pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' },
  );
  const medalPath = path.join(process.cwd(), "src", "templates", "selo.png");
  const medal = fs.readFileSync(medalPath, "base64");

  const data: ITemplate = { id, name, grade, date, medal }

  const content = await compile(data);

  console.log("Transformar em PDF");
  const browser = await chromium.puppeteer.lauch({
    headless: true,
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath: await chromium.executablePath
  });

  const page = await browser.newPage();

  await page.setContent(content);

  const pdf = await page.pdf({
      format: "a4",
      landscape: true,
      path: process.env.IS_OFFLINE ? "certificate.pdf" : null,
      printBackground: true,
      preferCSSPageSize: true,
  });

  await browser.close();

  console.log("Salvar no S3");
  const s3 = new S3();

  await s3.putObject({
      Bucket: "sls-certificates",
      Key: `${id}.pdf`,
      ACL: "public-read",
      Body: pdf,
      ContentType: "application/pdf"
  }).promise();

  return {
    statusCode: 201,
    body: JSON.stringify({
      message: "Certificate created",
      url: `https://sls-certificates.s3.amazonaws.com/${id}.pdf`
    }),
    headers: {
      "Content-Type": "application/json"
    }
  }
}